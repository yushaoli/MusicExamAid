const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireParent } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireParent(ctx);

    const { reg_id } = event;
    if (!reg_id) return fail('reg_id required', 'MISSING_REG_ID');

    const regRes = await db.collection('registrations').doc(reg_id).get();
    const reg = regRes.data;

    const learnerRes = await db.collection('learners').doc(reg.learner_id).get();
    if (learnerRes.data.household_id !== ctx.household_id) {
      return fail('Not your registration', 'FORBIDDEN');
    }

    if (!['Draft', 'NeedsChanges'].includes(reg.workflow_status)) {
      return fail('Cannot submit in current status', 'INVALID_STATUS');
    }

    await db.collection('registrations').doc(reg_id).update({
      data: {
        workflow_status: 'Submitted',
        updated_at: db.serverDate(),
      }
    });

    return success({ _id: reg_id });
  } catch (err) {
    return fail(err.message);
  }
};
