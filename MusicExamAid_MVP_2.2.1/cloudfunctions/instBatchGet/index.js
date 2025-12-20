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

    const itemsRes = await db.collection('institution_batch_items')
      .where({ inst_batch_id: batch_id })
      .get();

    const regIds = itemsRes.data.map(i => i.reg_id);
    let regs = [];
    if (regIds.length > 0) {
      const regsRes = await db.collection('registrations')
        .where({ _id: _.in(regIds) })
        .get();
      regs = regsRes.data;
    }
    const regMap = Object.fromEntries(regs.map(r => [r._id, r]));

    return success({
      batch,
      items: itemsRes.data.map(i => ({
        _id: i._id,
        reg_id: i.reg_id,
        reg: regMap[i.reg_id] || null,
      }))
    });
  } catch (err) {
    return fail(err.message);
  }
};
