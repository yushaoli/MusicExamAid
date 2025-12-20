const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const ExcelJS = require('exceljs');
const { success, fail, getAuthContext, requireSuper } = require('../shared');

// Export mapping from template header to snapshot_json path
const EXPORT_MAPPING = require('./export_mapping.json');

// Formatters
const formatters = {
  asText: (v) => v != null ? String(v) : '',
  asTextInt: (v) => v != null ? String(v) : '',
  asTrimmed: (v) => v != null ? String(v).trim() : '',
  asTrimmedOrDefault: (v, def) => v != null && v !== '' ? String(v).trim() : def,
  asEnum: (v, opts) => opts.enum?.includes(v) ? v : '',
  asEnumOrDefault: (v, opts) => opts.enum?.includes(v) ? v : opts.default,
  asDateText_YYYY_MM_DD: (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  },
};

// Get nested value from object by path (e.g., "repertoire.0")
const getByPath = (obj, path) => {
  if (!path) return undefined;
  const parts = path.split('.');
  let val = obj;
  for (const p of parts) {
    if (val == null) return undefined;
    val = val[p];
  }
  return val;
};

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { super_batch_id } = event;

    const batch = await db.collection('super_batches').doc(super_batch_id).get();
    if (batch.data.super_batch_status === 'Exported') {
      return fail('Batch already exported', 'ALREADY_EXPORTED');
    }

    // Get included items
    const itemsRes = await db.collection('super_batch_items')
      .where({ super_batch_id, include_status: 'Included' })
      .get();

    if (itemsRes.data.length === 0) {
      return fail('No items to export', 'EMPTY_BATCH');
    }

    // Get registrations with snapshots
    const regIds = itemsRes.data.map(i => i.reg_id);
    const regsRes = await db.collection('registrations')
      .where({ _id: db.command.in(regIds) })
      .get();

    // Load template from cloud storage
    const templateFileId = process.env.TEMPLATE_FILE_ID;
    let workbook = new ExcelJS.Workbook();
    
    if (templateFileId) {
      const templateRes = await cloud.downloadFile({ fileID: templateFileId });
      await workbook.xlsx.load(templateRes.fileContent);
    } else {
      // Create new workbook if no template
      workbook.addWorksheet('Sheet1');
    }

    const worksheet = workbook.worksheets[0];

    // Read header row (row 1)
    const headerRow = worksheet.getRow(1);
    const headers = [];
    headerRow.eachCell((cell, colNumber) => {
      headers.push({ col: colNumber, name: cell.value });
    });

    // Write data rows starting from row 2
    let rowNum = 2;
    for (const reg of regsRes.data) {
      const snapshot = reg.snapshot_json;
      if (!snapshot) continue;

      const row = worksheet.getRow(rowNum);
      
      for (const header of headers) {
        const mapping = EXPORT_MAPPING[header.name];
        if (!mapping) continue;

        const rawValue = getByPath(snapshot, mapping.path);
        const formatter = formatters[mapping.formatter] || formatters.asText;
        const formattedValue = formatter(rawValue, mapping);

        const cell = row.getCell(header.col);
        cell.value = formattedValue;
        
        // Force text for ID/phone fields
        if (['asText', 'asTextInt'].includes(mapping.formatter)) {
          cell.numFmt = '@';
        }
      }
      
      rowNum++;
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Upload to cloud storage
    const fileName = `exports/super_batch_${super_batch_id}_${Date.now()}.xlsx`;
    const uploadRes = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: buffer,
    });

    // Get temp URL
    const urlRes = await cloud.getTempFileURL({ fileList: [uploadRes.fileID] });
    const fileUrl = urlRes.fileList[0]?.tempFileURL || '';

    // Create export log
    const logRes = await db.collection('export_logs').add({
      data: {
        super_batch_id,
        file_id: uploadRes.fileID,
        file_url: fileUrl,
        record_count: regsRes.data.length,
        created_at: db.serverDate(),
      }
    });

    // Update batch status
    await db.collection('super_batches').doc(super_batch_id).update({
      data: {
        super_batch_status: 'Exported',
        exported_at: db.serverDate(),
      }
    });

    return success({
      export_id: logRes._id,
      record_count: regsRes.data.length,
      tempFileURL: fileUrl,
    });
  } catch (err) {
    return fail(err.message);
  }
};

