const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireSuper } = require('../shared');

const buildDedupKey = (reg) => {
  const idn = reg.snapshot_json?.id_number_plaintext || '';
  const subj = reg.subject_id || '';
  return `${idn}__${subj}`;
};

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { super_batch_id, inst_batch_ids } = event;
    if (!super_batch_id || !inst_batch_ids || inst_batch_ids.length === 0) {
      return fail('super_batch_id and inst_batch_ids required', 'MISSING_FIELDS');
    }

    const superBatchRes = await db.collection('super_batches').doc(super_batch_id).get();
    const superBatch = superBatchRes.data;

    if (superBatch.super_batch_status !== 'Draft') return fail('Super batch must be Draft', 'INVALID_STATUS');

    const instItemsRes = await db.collection('institution_batch_items')
      .where({ inst_batch_id: _.in(inst_batch_ids) })
      .get();

    const regIds = [...new Set(instItemsRes.data.map(i => i.reg_id))];
    if (regIds.length === 0) return fail('No items in institution batches', 'EMPTY_BATCH');

    const regsRes = await db.collection('registrations')
      .where({ _id: _.in(regIds) })
      .get();

    const existingItemsRes = await db.collection('super_batch_items')
      .where({ super_batch_id, reg_id: _.in(regIds) })
      .get();
    const existingSet = new Set(existingItemsRes.data.map(i => i.reg_id));

    const toAdd = [];
    const skipped = [];
    for (const r of regsRes.data) {
      if (existingSet.has(r._id)) continue;
      if (!r.snapshot_json) {
        skipped.push({ reg_id: r._id, reason: 'MISSING_SNAPSHOT' });
        continue;
      }
      toAdd.push({
        super_batch_id,
        reg_id: r._id,
        include_status: 'Included',
        excluded_reason_optional: '',
        dedup_key: buildDedupKey(r),
        created_at: db.serverDate(),
      });
    }

    await Promise.all(toAdd.map(d => db.collection('super_batch_items').add({ data: d })));

    const addedRegIds = toAdd.map(x => x.reg_id);
    if (addedRegIds.length > 0) {
      await db.collection('registrations')
        .where({ _id: _.in(addedRegIds) })
        .update({ data: { handoff_status: 'IncludedInSuperBatch', updated_at: db.serverDate() } });
    }

    return success({ added: toAdd.length, skipped });
  } catch (err) {
    return fail(err.message);
  }
};
