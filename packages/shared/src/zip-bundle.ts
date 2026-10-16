/**
 * Zero-dependency ZIP archive builder for MusicExamAid export bundles.
 *
 * Packages:
 * - `报名汇总表.csv` (Template v2.1 strict header roster)
 * - `photos/{id_number}_{name_cn}.jpg` (2-inch portrait photos named by official rule)
 * - `manifest.json` (export metadata, photo naming index, and checksums)
 */

import * as crypto from 'crypto';
import { decryptIdNumber, serializeExportRowsToCsv, mapSnapshotToExportRow } from './snapshot-crypto';
import type { RegistrationSnapshot } from './snapshot-crypto';

export interface ZipEntryInput {
  /** Path inside the ZIP archive, e.g. `报名汇总表.csv` or `photos/110101..._张小琴.jpg` */
  name: string;
  /** Raw file content */
  data: Buffer;
}

// Precompute standard CRC-32 lookup table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Create a standard PKZIP (STORE / method 0) archive buffer from a list of entries.
 */
export function buildZipArchive(entries: ReadonlyArray<ZipEntryInput>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = entry.data;
    const crc = crc32(dataBuf);
    const size = dataBuf.length;

    // Local file header (30 bytes + file name)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // Local file header signature
    local.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6);     // General purpose bit flag (UTF-8 filename)
    local.writeUInt16LE(0, 8);          // Compression method: 0 (STORE)
    local.writeUInt16LE(0, 10);         // Last mod file time
    local.writeUInt16LE(0x5421, 12);    // Last mod file date
    local.writeUInt32LE(crc, 14);       // CRC-32
    local.writeUInt32LE(size, 18);      // Compressed size
    local.writeUInt32LE(size, 22);      // Uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // File name length
    local.writeUInt16LE(0, 28);         // Extra field length
    nameBuf.copy(local, 30);

    localHeaders.push(local, dataBuf);

    // Central directory header (46 bytes + file name)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // Central file header signature
    central.writeUInt16LE(20, 4);         // Version made by
    central.writeUInt16LE(20, 6);         // Version needed
    central.writeUInt16LE(0x0800, 8);     // UTF-8 flag
    central.writeUInt16LE(0, 10);         // Compression method: STORE
    central.writeUInt16LE(0, 12);         // File time
    central.writeUInt16LE(0x5421, 14);    // File date
    central.writeUInt32LE(crc, 16);       // CRC-32
    central.writeUInt32LE(size, 20);      // Compressed size
    central.writeUInt32LE(size, 24);      // Uncompressed size
    central.writeUInt16LE(nameBuf.length, 28); // File name length
    central.writeUInt16LE(0, 30);         // Extra field length
    central.writeUInt16LE(0, 32);         // File comment length
    central.writeUInt16LE(0, 34);         // Disk number start
    central.writeUInt16LE(0, 36);         // Internal file attributes
    central.writeUInt32LE(0, 38);         // External file attributes
    central.writeUInt32LE(offset, 42);    // Relative offset of local header
    nameBuf.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + dataBuf.length;
  }

  const centralDirSize = centralHeaders.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4);          // Number of this disk
  eocd.writeUInt16LE(0, 6);          // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8);  // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
  eocd.writeUInt32LE(offset, 16);         // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);              // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export interface PortraitPhotoAsset {
  registrationId: string;
  photoBuffer?: Buffer;
}

/**
 * Compute the canonical portrait photo filename inside the export ZIP bundle:
 * `photos/{id_number}_{name_cn}.jpg` (decrypted in memory only).
 */
export function formatPortraitPhotoZipPath(
  snapshot: RegistrationSnapshot,
  encryptionKey?: string,
): string {
  const plaintextId = decryptIdNumber(snapshot.id_number_encrypted, encryptionKey).trim();
  const safeName = (snapshot.name_cn || 'learner').trim().replace(/[\\/:*?"<>|]/g, '_');
  return `photos/${plaintextId}_${safeName}.jpg`;
}

// Minimal valid 1x1 JPEG placeholder when binary S3 object is not fetched yet
const MINIMAL_JPEG_PLACEHOLDER = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

/**
 * Build the complete Export ZIP Bundle containing:
 * 1. `报名汇总表.csv` (Template v2.1 roster)
 * 2. `photos/{证件号码}_{姓名}.jpg` for each locked registration snapshot
 * 3. `manifest.json` (audit manifest with SHA-256 hashes)
 */
export function buildExportZipBundle(params: {
  jobId: string;
  cycleId: string;
  snapshots: ReadonlyArray<RegistrationSnapshot>;
  photosByKey?: Record<string, Buffer>;
  encryptionKey?: string;
}): {
  zipBuffer: Buffer;
  fileList: string[];
} {
  const rows = params.snapshots.map(s =>
    mapSnapshotToExportRow(s, params.encryptionKey),
  );
  const csvContent = serializeExportRowsToCsv(rows);
  const csvBuffer = Buffer.from(csvContent, 'utf8');

  const entries: ZipEntryInput[] = [
    {
      name: '报名汇总表.csv',
      data: csvBuffer,
    },
  ];

  const photoManifest: Array<{
    path: string;
    name_cn: string;
    id_last4: string;
    sha256: string;
  }> = [];

  for (const snap of params.snapshots) {
    const photoPath = formatPortraitPhotoZipPath(snap, params.encryptionKey);
    const photoBuf =
      params.photosByKey?.[snap.id_last4] ?? MINIMAL_JPEG_PLACEHOLDER;
    entries.push({
      name: photoPath,
      data: photoBuf,
    });
    photoManifest.push({
      path: photoPath,
      name_cn: snap.name_cn,
      id_last4: snap.id_last4,
      sha256: crypto.createHash('sha256').update(photoBuf).digest('hex'),
    });
  }

  const manifestObj = {
    job_id: params.jobId,
    cycle_id: params.cycleId,
    generated_at: new Date().toISOString(),
    record_count: params.snapshots.length,
    roster_file: '报名汇总表.csv',
    photos: photoManifest,
  };

  entries.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifestObj, null, 2), 'utf8'),
  });

  return {
    zipBuffer: buildZipArchive(entries),
    fileList: entries.map(e => e.name),
  };
}
