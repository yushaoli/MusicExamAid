const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireParent } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireParent(ctx);

    const { reg_id, subject_id, level, exam_mode, exam_site_id_optional, repertoire } = event;

    // Get registration and verify ownership
    const reg = await db.collection('registrations').doc(reg_id).get();
    const learner = await db.collection('learners').doc(reg.data.learner_id).get();
    
    if (learner.data.household_id !== ctx.household_id) {
      return fail('Not your registration', 'FORBIDDEN');
    }

    // Only allow edit in Draft or NeedsChanges
    if (!['Draft', 'NeedsChanges'].includes(reg.data.workflow_status)) {
      return fail('Cannot edit in current status', 'INVALID_STATUS');
    }

    await db.collection('registrations').doc(reg_id).update({
      data: {
        subject_id,
        level,
        exam_mode,
        exam_site_id_optional: exam_site_id_optional || '',
        repertoire: repertoire || [],
        updated_at: db.serverDate(),
      }
    });

    return success({ _id: reg_id });
  } catch (err) {
    return fail(err.message);
  }
};

