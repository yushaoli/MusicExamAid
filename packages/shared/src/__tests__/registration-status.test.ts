import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RegistrationStatus as RS,
  VALID_TRANSITIONS,
  canTransition,
  assertTransition,
} from '../registration-status';
import {
  encryptIdNumber,
  decryptIdNumber,
  getIdLast4,
  resolveSubjectName,
  buildRegistrationSnapshot,
  computeMissingFlags,
  mapSnapshotToExportRow,
  serializeExportRowsToCsv,
} from '../snapshot-crypto';

// ---------------------------------------------------------------------------
// canTransition – valid transitions
// ---------------------------------------------------------------------------

describe('canTransition – valid transitions', () => {
  it('draft → submitted', () => {
    assert.equal(canTransition(RS.DRAFT, RS.SUBMITTED), true);
  });

  it('submitted → needs_change', () => {
    assert.equal(canTransition(RS.SUBMITTED, RS.NEEDS_CHANGE), true);
  });

  it('submitted → confirmed', () => {
    assert.equal(canTransition(RS.SUBMITTED, RS.CONFIRMED), true);
  });

  it('submitted → locked (1-click confirm & lock shortcut)', () => {
    assert.equal(canTransition(RS.SUBMITTED, RS.LOCKED), true);
  });

  it('needs_change → submitted', () => {
    assert.equal(canTransition(RS.NEEDS_CHANGE, RS.SUBMITTED), true);
  });

  it('confirmed → locked', () => {
    assert.equal(canTransition(RS.CONFIRMED, RS.LOCKED), true);
  });

  it('locked → confirmed (unlock)', () => {
    assert.equal(canTransition(RS.LOCKED, RS.CONFIRMED), true);
  });

  it('locked → needs_change (unlock & return to parent)', () => {
    assert.equal(canTransition(RS.LOCKED, RS.NEEDS_CHANGE), true);
  });
});

// ---------------------------------------------------------------------------
// canTransition – invalid transitions
// ---------------------------------------------------------------------------

describe('canTransition – invalid transitions', () => {
  it('draft → confirmed', () => {
    assert.equal(canTransition(RS.DRAFT, RS.CONFIRMED), false);
  });

  it('draft → locked', () => {
    assert.equal(canTransition(RS.DRAFT, RS.LOCKED), false);
  });

  it('locked → draft', () => {
    assert.equal(canTransition(RS.LOCKED, RS.DRAFT), false);
  });

  it('locked → submitted', () => {
    assert.equal(canTransition(RS.LOCKED, RS.SUBMITTED), false);
  });

  it('confirmed → submitted (skip back)', () => {
    assert.equal(canTransition(RS.CONFIRMED, RS.SUBMITTED), false);
  });

  it('confirmed → draft (skip back)', () => {
    assert.equal(canTransition(RS.CONFIRMED, RS.DRAFT), false);
  });
});

// ---------------------------------------------------------------------------
// assertTransition
// ---------------------------------------------------------------------------

describe('assertTransition', () => {
  it('does not throw for valid transition', () => {
    assert.doesNotThrow(() => assertTransition(RS.DRAFT, RS.SUBMITTED));
    assert.doesNotThrow(() => assertTransition(RS.SUBMITTED, RS.LOCKED));
    assert.doesNotThrow(() => assertTransition(RS.CONFIRMED, RS.LOCKED));
    assert.doesNotThrow(() => assertTransition(RS.LOCKED, RS.CONFIRMED));
  });

  it('throws for invalid transition', () => {
    assert.throws(() => assertTransition(RS.DRAFT, RS.LOCKED));
  });

  it('error message includes both states', () => {
    assert.throws(
      () => assertTransition(RS.DRAFT, RS.LOCKED),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes(RS.DRAFT),
          `expected "${RS.DRAFT}" in message: ${err.message}`,
        );
        assert.ok(
          err.message.includes(RS.LOCKED),
          `expected "${RS.LOCKED}" in message: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS completeness
// ---------------------------------------------------------------------------

describe('VALID_TRANSITIONS', () => {
  it('has an entry for every status value', () => {
    const statuses = Object.values(RS);
    for (const status of statuses) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(VALID_TRANSITIONS, status),
        `Missing VALID_TRANSITIONS entry for status: ${status}`,
      );
    }
  });

  it('all target statuses are known values', () => {
    const known = new Set(Object.values(RS));
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        assert.ok(
          known.has(to as RS),
          `Unknown target "${to}" in VALID_TRANSITIONS["${from}"]`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AES-256-GCM ID Encryption, Encrypted-at-Rest Snapshot & Template v2.1 CSV
// ---------------------------------------------------------------------------

describe('snapshot-crypto & Template v2.1 mapping', () => {
  it('encrypts with AES-256-GCM, decrypts symmetrically, and extracts last4', () => {
    const plain = '110101201605011234';
    const enc = encryptIdNumber(plain);
    assert.ok(enc.startsWith('gcm:'));
    assert.equal(decryptIdNumber(enc), plain);
    assert.equal(getIdLast4(plain), '1234');
  });

  it('keeps ID encrypted at rest in snapshot, resolves subject_id -> Chinese name, and serializes CSV', () => {
    const plainId = '310101201508085678';
    const encryptedId = encryptIdNumber(plainId);
    assert.equal(resolveSubjectName('piano'), '钢琴');

    const snapshot = buildRegistrationSnapshot({
      learner: {
        name_cn: '李小华',
        gender: '男',
        dob: '2015-08-08',
        id_type: '身份证',
        id_number_encrypted: encryptedId,
        guardian_phone: '13900139000',
      },
      registration: {
        subject_id: 'piano',
        level: 6,
        repertoire: ['音阶与琶音', '车尔尼练习曲'],
        exam_mode: '现场',
        cycle_id: '2025-summer',
      },
      institution: { legacy_org_id: 'ORG_88' },
      teacherProfile: { teacher_name: '王老师', teacher_phone: '13700137000' },
    });

    // Ensure plaintext ID is NOT stored on snapshot at rest
    assert.equal(
      (snapshot as unknown as Record<string, unknown>).id_number_plaintext,
      undefined,
    );
    assert.equal(snapshot.id_number_encrypted, encryptedId);
    assert.equal(snapshot.id_last4, '5678');
    assert.equal(snapshot.instrument, '钢琴');
    assert.deepEqual(snapshot.repertoire, ['音阶与琶音', '车尔尼练习曲', '', '']);
    assert.deepEqual(computeMissingFlags(snapshot, true), []);
    assert.deepEqual(computeMissingFlags(snapshot, false), ['portrait_photo']);

    // Decrypts only in memory when mapping to export row
    const row = mapSnapshotToExportRow(snapshot);
    assert.equal(row['报名机构ID'], 'ORG_88');
    assert.equal(row['姓名'], '李小华');
    assert.equal(row['证件号码'], plainId);
    assert.equal(row['报考专业'], '钢琴');
    assert.equal(row['报考级别'], '6');

    const csv = serializeExportRowsToCsv([row]);
    assert.ok(csv.startsWith('\uFEFF"报名机构ID"'));
    assert.ok(csv.includes('"\t310101201508085678"'));
  });
});

// ---------------------------------------------------------------------------
// SuperBatch Deduplication & Conflict Resolution
// ---------------------------------------------------------------------------

import { evaluateBatchDedup } from '../dedup';

describe('evaluateBatchDedup', () => {
  it('auto-keeps newest locked_at for same-level duplicates and flags level/institution conflicts', () => {
    const res = evaluateBatchDedup([
      {
        id: 'reg_old',
        learner_id: 'lrn_1',
        institution_id: 'inst_A',
        cycle_id: '2025-summer',
        subject_id: 'piano',
        level: 5,
        locked_at: '2025-05-01T10:00:00.000Z',
      },
      {
        id: 'reg_new',
        learner_id: 'lrn_1',
        institution_id: 'inst_A',
        cycle_id: '2025-summer',
        subject_id: 'piano',
        level: 5,
        locked_at: '2025-05-02T10:00:00.000Z',
      },
      {
        id: 'reg_conflict_a',
        learner_id: 'lrn_2',
        institution_id: 'inst_A',
        cycle_id: '2025-summer',
        subject_id: 'violin',
        level: 4,
        locked_at: '2025-05-01T10:00:00.000Z',
      },
      {
        id: 'reg_conflict_b',
        learner_id: 'lrn_2',
        institution_id: 'inst_A',
        cycle_id: '2025-summer',
        subject_id: 'violin',
        level: 6,
        locked_at: '2025-05-02T10:00:00.000Z',
      },
    ]);

    assert.deepEqual(res.included_ids, ['reg_new']);
    assert.deepEqual(res.excluded_ids, ['reg_old']);
    assert.deepEqual(res.conflict_ids, ['reg_conflict_a', 'reg_conflict_b']);
  });
});

