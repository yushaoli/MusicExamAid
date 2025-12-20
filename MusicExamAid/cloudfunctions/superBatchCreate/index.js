const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireSuper } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { cycle_id } = event;

    const res = await db.collection('super_batches').add({
      data: {
        cycle_id,
        template_version: 'v2.1',
        super_batch_status: 'Draft',
        created_at: db.serverDate(),
        exported_at: null,
      }
    });

    return success({ _id: res._id });
  } catch (err) {
    return fail(err.message);
  }
};

