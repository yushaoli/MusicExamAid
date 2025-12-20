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

    // Get household
    const householdRes = await db.collection('households').where({ openid }).get();
    const household = householdRes.data[0];
    if (!household) return fail('No household', 'NO_HOUSEHOLD');

    const res = await db.collection('learners')
      .where({ household_id: household._id })
      .orderBy('created_at', 'desc')
      .get();

    // Never return encrypted id_number, only last4
    const learners = res.data.map(l => ({
      _id: l._id,
      name_cn: l.name_cn,
      name_en_optional: l.name_en_optional,
      gender: l.gender,
      dob: l.dob,
      id_type: l.id_type,
      id_last4: l.id_last4,
      guardian_phone: l.guardian_phone,
      created_at: l.created_at,
    }));

    return success(learners);
  } catch (err) {
    return fail(err.message);
  }
};
