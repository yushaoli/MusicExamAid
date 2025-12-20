const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireAdmin } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireAdmin(ctx);

    const { cycle_id, inst_batch_status, class_id } = event || {};

    const query = { class_id: _.in(ctx.classIds) };
    if (class_id) query.class_id = class_id;
    if (cycle_id) query.cycle_id = cycle_id;
    if (inst_batch_status) query.inst_batch_status = inst_batch_status;

    const res = await db.collection('institution_batches')
      .where(query)
      .orderBy('created_at', 'desc')
      .limit(100)
      .get();

    return success(res.data);
  } catch (err) {
    return fail(err.message);
  }
};
