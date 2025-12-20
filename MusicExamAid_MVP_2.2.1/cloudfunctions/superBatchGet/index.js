const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireSuper } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { batch_id } = event;
    if (!batch_id) return fail('batch_id required', 'MISSING_BATCH_ID');

    const batchRes = await db.collection('super_batches').doc(batch_id).get();
    const batch = batchRes.data;

    const itemsRes = await db.collection('super_batch_items')
      .where({ super_batch_id: batch_id })
      .get();

    const regIds = itemsRes.data.map(i => i.reg_id);
    let regMap = {};
    if (regIds.length > 0) {
      const regsRes = await db.collection('registrations').where({ _id: _.in(regIds) }).get();
      regMap = Object.fromEntries(regsRes.data.map(r => [r._id, r]));
    }

    return success({
      batch,
      items: itemsRes.data.map(i => ({
        ...i,
        reg: regMap[i.reg_id] || null,
      })),
    });
  } catch (err) {
    return fail(err.message);
  }
};
