const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireTeacher, requireClassAccess, buildSnapshot, computeMissingFlags, writeAuditLog } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireTeacher(ctx);

    const { reg_id } = event;

    const reg = await db.collection('registrations').doc(reg_id).get();
    requireClassAccess(ctx, reg.data.class_id);

    if (reg.data.workflow_status !== 'Confirmed') {
      return fail('Must be Confirmed to lock', 'INVALID_STATUS');
    }

    // Check portrait_photo attachment exists
    const attachRes = await db.collection('attachments')
      .where({ owner_type: 'learner', owner_id: reg.data.learner_id, file_type: 'portrait_photo' })
      .get();
    const hasPortrait = attachRes.data.length > 0;

    // Get learner
    const learner = await db.collection('learners').doc(reg.data.learner_id).get();

    // Get institution
    const instRes = await db.collection('institutions').doc(reg.data.class_id).get();
    const institution = instRes.data;

    // Get teacher profile for this class
    const profileRes = await db.collection('teacher_profiles')
      .where({ class_id: reg.data.class_id, teacher_account_id: ctx.teacherAccount?._id })
      .get();
    const teacherProfile = profileRes.data[0] || null;

    // Build snapshot
    const snapshot = await buildSnapshot(db, reg.data, learner.data, institution, teacherProfile);

    // Compute missing flags
    const missingFlags = computeMissingFlags(snapshot, hasPortrait);

    if (missingFlags.length > 0 && missingFlags.includes('portrait_photo')) {
      return fail('Portrait photo required', 'MISSING_PORTRAIT');
    }

    await db.collection('registrations').doc(reg_id).update({
      data: {
        workflow_status: 'Locked',
        snapshot_json: snapshot,
        missing_flags: missingFlags,
        locked_at: db.serverDate(),
        updated_at: db.serverDate(),
      }
    });

    await writeAuditLog(db, {
      entity_type: 'registration',
      entity_id: reg_id,
      actor_openid: ctx.openid,
      actor_role: 'Teacher',
      action: 'lock',
      diff_json: { missing_flags: missingFlags },
    });

    return success({ _id: reg_id, missing_flags: missingFlags });
  } catch (err) {
    return fail(err.message);
  }
};

