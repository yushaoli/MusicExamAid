const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireTeacher, requireClassAccess } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireTeacher(ctx);

    const { reg_id } = event;
    const reg = await db.collection('registrations').doc(reg_id).get();
    requireClassAccess(ctx, reg.data.class_id);

    if (reg.data.workflow_status !== 'Locked') {
      return fail('Must be Locked to submit to institution', 'INVALID_STATUS');
    }

    await db.collection('registrations').doc(reg_id).update({
      data: {
        handoff_status: 'SubmittedToInstitution',
        updated_at: db.serverDate(),
      }
    });

    return success({ _id: reg_id });
  } catch (err) {
    return fail(err.message);
  }
};

