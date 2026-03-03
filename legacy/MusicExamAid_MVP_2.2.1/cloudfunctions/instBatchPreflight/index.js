const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireAdmin, requireClassAccess } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireAdmin(ctx);

    const { batch_id } = event;
    if (!batch_id) return fail('batch_id required', 'MISSING_BATCH_ID');

    const batchRes = await db.collection('institution_batches').doc(batch_id).get();
    const batch = batchRes.data;
    requireClassAccess(ctx, batch.class_id);

    const itemsRes = await db.collection('institution_batch_items').where({ inst_batch_id: batch_id }).get();
    const regIds = itemsRes.data.map(i => i.reg_id);

    if (regIds.length === 0) return success({ ok: false, blocking: ['EMPTY_BATCH'], warnings: [], item_count: 0 });

    const regsRes = await db.collection('registrations').where({ _id: _.in(regIds) }).get();
    const blocking = [];
    const warnings = [];

    for (const r of regsRes.data) {
      if (r.workflow_status !== 'Locked') blocking.push({ reg_id: r._id, reason: 'NOT_LOCKED' });
      if (!r.snapshot_json) blocking.push({ reg_id: r._id, reason: 'MISSING_SNAPSHOT' });
      if (Array.isArray(r.missing_flags) && r.missing_flags.length > 0) warnings.push({ reg_id: r._id, reason: 'MISSING_FLAGS', flags: r.missing_flags });
    }

    return success({
      ok: blocking.length === 0,
      item_count: regIds.length,
      blocking,
      warnings,
    });
  } catch (err) {
    return fail(err.message);
  }
};
