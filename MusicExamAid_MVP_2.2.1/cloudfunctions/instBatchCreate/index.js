const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireAdmin, requireClassAccess } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireAdmin(ctx);

    const { class_id, cycle_id } = event;
    requireClassAccess(ctx, class_id);

    // Find teacher profile for this admin
    const profileRes = await db.collection('teacher_profiles')
      .where({ class_id, teacher_account_id: ctx.teacherAccount._id, role: db.command.in(['Admin', 'Super']) })
      .get();
    if (profileRes.data.length === 0) {
      return fail('No admin profile for this class', 'FORBIDDEN');
    }

    const res = await db.collection('institution_batches').add({
      data: {
        class_id,
        cycle_id,
        template_version: 'v2.1',
        inst_batch_status: 'Draft',
        created_by_teacher_profile_id: profileRes.data[0]._id,
        created_at: db.serverDate(),
        submitted_at: null,
      }
    });

    return success({ _id: res._id });
  } catch (err) {
    return fail(err.message);
  }
};

