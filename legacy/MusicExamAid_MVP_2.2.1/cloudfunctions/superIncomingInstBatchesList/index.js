const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireSuper } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { cycle_id } = event || {};

    const query = { inst_batch_status: 'SubmittedToSuper' };
    if (cycle_id) query.cycle_id = cycle_id;

    const batchesRes = await db.collection('institution_batches')
      .where(query)
      .orderBy('submitted_at', 'desc')
      .limit(200)
      .get();

    const classIds = [...new Set(batchesRes.data.map(b => b.class_id))];
    let instMap = {};
    if (classIds.length > 0) {
      const instRes = await db.collection('institutions').where({ _id: _.in(classIds) }).get();
      instMap = Object.fromEntries(instRes.data.map(i => [i._id, i]));
    }

    const results = [];
    for (const b of batchesRes.data) {
      const cnt = await db.collection('institution_batch_items').where({ inst_batch_id: b._id }).count();
      results.push({
        ...b,
        institution_name: instMap[b.class_id]?.name || '',
        item_count: cnt.total || 0,
      });
    }

    return success(results);
  } catch (err) {
    return fail(err.message);
  }
};
