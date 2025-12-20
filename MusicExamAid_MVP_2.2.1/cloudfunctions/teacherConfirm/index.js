const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireTeacher, requireClassAccess, writeAuditLog } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireTeacher(ctx);

    const { reg_id } = event;
    if (!reg_id) return fail('reg_id required', 'MISSING_REG_ID');

    const regRes = await db.collection('registrations').doc(reg_id).get();
    const reg = regRes.data;
    requireClassAccess(ctx, reg.class_id);

    if (reg.workflow_status !== 'Submitted') {
      return fail('Must be Submitted to confirm', 'INVALID_STATUS');
    }

    await db.collection('registrations').doc(reg_id).update({
      data: {
        workflow_status: 'Confirmed',
        confirmed_at: db.serverDate(),
        updated_at: db.serverDate(),
      }
    });

    await writeAuditLog(db, {
      entity_type: 'registration',
      entity_id: reg_id,
      actor_openid: ctx.openid,
      actor_role: 'Teacher',
      action: 'confirm',
      diff_json: {},
    });

    return success({ _id: reg_id });
  } catch (err) {
    return fail(err.message);
  }
};
