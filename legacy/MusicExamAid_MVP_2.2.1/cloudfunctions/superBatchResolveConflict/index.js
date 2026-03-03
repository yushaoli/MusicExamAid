const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireSuper } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { item_id, action } = event;
    if (!item_id || !action) return fail('item_id and action required', 'MISSING_FIELDS');

    const itemRes = await db.collection('super_batch_items').doc(item_id).get();
    const item = itemRes.data;

    if (action === 'include') {
      await db.collection('super_batch_items').doc(item_id).update({
        data: { include_status: 'Included', excluded_reason_optional: '' }
      });
    } else if (action === 'exclude') {
      await db.collection('super_batch_items').doc(item_id).update({
        data: { include_status: 'Excluded', excluded_reason_optional: 'manual_exclude' }
      });
    } else {
      return fail('Invalid action', 'INVALID_ACTION');
    }

    return success({ _id: item_id, super_batch_id: item.super_batch_id, action });
  } catch (err) {
    return fail(err.message);
  }
};
