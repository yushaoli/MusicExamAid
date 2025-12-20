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

    const { learner_id } = event;
    const res = await db.collection('learners').doc(learner_id).get();
    const l = res.data;

    if (l.household_id !== household._id) {
      return fail('Not your learner', 'FORBIDDEN');
    }

    return success({
      _id: l._id,
      name_cn: l.name_cn,
      name_en_optional: l.name_en_optional,
      gender: l.gender,
      dob: l.dob,
      nationality: l.nationality,
      ethnicity_optional: l.ethnicity_optional,
      id_type: l.id_type,
      id_last4: l.id_last4,
      guardian_phone: l.guardian_phone,
      mailing_address_optional: l.mailing_address_optional,
      recipient_name_optional: l.recipient_name_optional,
      recipient_phone_optional: l.recipient_phone_optional,
    });
  } catch (err) {
    return fail(err.message);
  }
};
