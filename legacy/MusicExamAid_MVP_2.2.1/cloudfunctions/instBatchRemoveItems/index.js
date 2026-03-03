const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireAdmin, requireClassAccess } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireAdmin(ctx);

    const { batch_id, item_ids } = event;
    if (!batch_id || !item_ids || item_ids.length === 0) return fail('batch_id and item_ids required', 'MISSING_FIELDS');

    const batchRes = await db.collection('institution_batches').doc(batch_id).get();
    const batch = batchRes.data;
    requireClassAccess(ctx, batch.class_id);

    if (batch.inst_batch_status !== 'Draft') return fail('Batch is not in Draft status', 'INVALID_STATUS');

    const itemsRes = await db.collection('institution_batch_items')
      .where({ _id: _.in(item_ids), inst_batch_id: batch_id })
      .get();

    const regIds = itemsRes.data.map(i => i.reg_id);

    await Promise.all(itemsRes.data.map(i => db.collection('institution_batch_items').doc(i._id).remove()));

    if (regIds.length > 0) {
      await db.collection('registrations')
        .where({ _id: _.in(regIds) })
        .update({ data: { handoff_status: 'SubmittedToInstitution', updated_at: db.serverDate() } });
    }

    return success({ removed: itemsRes.data.length });
  } catch (err) {
    return fail(err.message);
  }
};
