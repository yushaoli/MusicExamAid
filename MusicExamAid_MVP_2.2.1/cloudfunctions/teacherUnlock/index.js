const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireTeacher, requireClassAccess, writeAuditLog } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireTeacher(ctx);

    const { reg_id, reason } = event;
    if (!reason) return fail('Reason required', 'MISSING_REASON');

    const reg = await db.collection('registrations').doc(reg_id).get();
    requireClassAccess(ctx, reg.data.class_id);

    if (reg.data.workflow_status !== 'Locked') {
      return fail('Must be Locked to unlock', 'INVALID_STATUS');
    }

    // Cannot unlock if already in a batch
    if (['IncludedInInstitutionBatch', 'IncludedInSuperBatch'].includes(reg.data.handoff_status)) {
      return fail('Cannot unlock - already in batch', 'IN_BATCH');
    }

    await db.collection('registrations').doc(reg_id).update({
      data: {
        workflow_status: 'Confirmed',
        snapshot_json: null,
        locked_at: null,
        handoff_status: 'None',
        updated_at: db.serverDate(),
      }
    });

    await writeAuditLog(db, {
      entity_type: 'registration',
      entity_id: reg_id,
      actor_openid: ctx.openid,
      actor_role: 'Teacher',
      action: 'unlock',
      diff_json: { reason },
    });

    return success({ _id: reg_id });
  } catch (err) {
    return fail(err.message);
  }
};

