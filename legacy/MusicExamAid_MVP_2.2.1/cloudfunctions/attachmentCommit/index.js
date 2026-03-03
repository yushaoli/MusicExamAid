const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireParent } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireParent(ctx);

    const { owner_type, owner_id, file_type, cloud_file_id } = event;

    // Verify ownership if learner
    if (owner_type === 'learner') {
      const learner = await db.collection('learners').doc(owner_id).get();
      if (learner.data.household_id !== ctx.household_id) {
        return fail('Not your learner', 'FORBIDDEN');
      }
    }

    // Check for existing attachment of same type
    const existingRes = await db.collection('attachments')
      .where({ owner_type, owner_id, file_type })
      .get();

    if (existingRes.data.length > 0) {
      // Update existing
      await db.collection('attachments').doc(existingRes.data[0]._id).update({
        data: {
          cloud_file_id,
          uploaded_at: db.serverDate(),
        }
      });
      return success({ _id: existingRes.data[0]._id });
    }

    // Create new
    const res = await db.collection('attachments').add({
      data: {
        owner_type,
        owner_id,
        file_type,
        cloud_file_id,
        file_url_optional: '',
        uploaded_at: db.serverDate(),
      }
    });

    return success({ _id: res._id });
  } catch (err) {
    return fail(err.message);
  }
};

