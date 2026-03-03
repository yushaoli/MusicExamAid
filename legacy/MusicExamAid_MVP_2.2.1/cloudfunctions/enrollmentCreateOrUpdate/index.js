const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireParent } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireParent(ctx);

    const { learner_id, class_id, consent_status } = event;

    // Verify learner ownership
    const learner = await db.collection('learners').doc(learner_id).get();
    if (learner.data.household_id !== ctx.household_id) {
      return fail('Not your learner', 'FORBIDDEN');
    }

    // Check existing enrollment
    const existingRes = await db.collection('enrollments')
      .where({ learner_id, class_id })
      .get();

    if (existingRes.data.length > 0) {
      // Update
      await db.collection('enrollments').doc(existingRes.data[0]._id).update({
        data: { consent_status }
      });
      return success({ _id: existingRes.data[0]._id });
    }

    // Create
    const res = await db.collection('enrollments').add({
      data: {
        learner_id,
        class_id,
        consent_status: consent_status || 'Pending',
        created_at: db.serverDate(),
      }
    });

    return success({ _id: res._id });
  } catch (err) {
    return fail(err.message);
  }
};

