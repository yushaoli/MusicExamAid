const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const success = (data) => ({ success: true, data });
const fail = (error, code = 'ERROR') => ({ success: false, error, code });

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    if (!openid) return fail('No openid', 'UNAUTHORIZED');

    // Upsert household
    const householdRes = await db.collection('households').where({ openid }).get();
    let household = householdRes.data[0];
    if (!household) {
      const addRes = await db.collection('households').add({
        data: { openid, created_at: db.serverDate() }
      });
      household = { _id: addRes._id, openid };
    }

    // Check teacher_accounts
    const accountRes = await db.collection('teacher_accounts').where({ openid }).get();
    const teacherAccount = accountRes.data[0] || null;

    let teacherProfiles = [];
    if (teacherAccount) {
      const profilesRes = await db.collection('teacher_profiles')
        .where({ teacher_account_id: teacherAccount._id })
        .get();
      teacherProfiles = profilesRes.data;
    }

    const roles = teacherProfiles.map(p => p.role);
    return success({
      openid,
      household_id: household._id,
      teacher_profiles: teacherProfiles.map(p => ({
        _id: p._id,
        class_id: p.class_id,
        role: p.role,
        teacher_name: p.teacher_name,
        can_export: p.can_export_optional || false,
      })),
      isTeacher: roles.includes('Teacher') || roles.includes('Admin') || roles.includes('Super'),
      isAdmin: roles.includes('Admin') || roles.includes('Super'),
      isSuper: roles.includes('Super'),
    });
  } catch (err) {
    return fail(err.message);
  }
};
