const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireAdmin, requireClassAccess } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireAdmin(ctx);

    const { batch_id } = event;

    const batch = await db.collection('institution_batches').doc(batch_id).get();
    requireClassAccess(ctx, batch.data.class_id);

    if (batch.data.inst_batch_status !== 'Draft') {
      return fail('Batch must be in Draft status', 'INVALID_STATUS');
    }

    // Verify has items
    const itemsRes = await db.collection('institution_batch_items')
      .where({ inst_batch_id: batch_id })
      .count();
    if (itemsRes.total === 0) {
      return fail('Batch has no items', 'EMPTY_BATCH');
    }

    await db.collection('institution_batches').doc(batch_id).update({
      data: {
        inst_batch_status: 'SubmittedToSuper',
        submitted_at: db.serverDate(),
      }
    });

    return success({ _id: batch_id });
  } catch (err) {
    return fail(err.message);
  }
};

