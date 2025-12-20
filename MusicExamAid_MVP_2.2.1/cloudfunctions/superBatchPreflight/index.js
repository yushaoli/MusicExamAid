const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireSuper } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { super_batch_id } = event;
    if (!super_batch_id) return fail('super_batch_id required', 'MISSING_BATCH_ID');

    const itemsRes = await db.collection('super_batch_items')
      .where({ super_batch_id, include_status: 'Included' })
      .get();

    if (itemsRes.data.length === 0) return success({ ok: false, blocking: ['EMPTY_BATCH'], conflicts: [] });

    const groups = {};
    for (const i of itemsRes.data) {
      const k = i.dedup_key || '';
      if (!k) continue;
      groups[k] = groups[k] || [];
      groups[k].push(i);
    }

    const conflicts = Object.entries(groups)
      .filter(([_, arr]) => arr.length > 1)
      .map(([k, arr]) => ({ dedup_key: k, item_ids: arr.map(x => x._id) }));

    return success({
      ok: conflicts.length === 0,
      blocking: conflicts.length ? ['DEDUP_CONFLICTS'] : [],
      conflicts,
      included_count: itemsRes.data.length,
    });
  } catch (err) {
    return fail(err.message);
  }
};
