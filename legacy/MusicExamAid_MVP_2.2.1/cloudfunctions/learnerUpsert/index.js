const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const success = (data) => ({ success: true, data });
const fail = (error, code = 'ERROR') => ({ success: false, error, code });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-key-for-dev-only!';

const encrypt = (text) => {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

const getLast4 = (idNumber) => {
  if (!idNumber || idNumber.length < 4) return '';
  return idNumber.slice(-4);
};

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    if (!openid) return fail('No openid', 'UNAUTHORIZED');

    // Get household
    const householdRes = await db.collection('households').where({ openid }).get();
    const household = householdRes.data[0];
    if (!household) return fail('No household', 'NO_HOUSEHOLD');

    const {
      learner_id,
      name_cn, name_en_optional, gender, dob, nationality, ethnicity_optional,
      id_type, id_number,
      guardian_phone, mailing_address_optional, recipient_name_optional, recipient_phone_optional
    } = event;

    const data = {
      name_cn,
      name_en_optional: name_en_optional || '',
      gender,
      dob,
      nationality: nationality || '中国',
      ethnicity_optional: ethnicity_optional || '',
      id_type,
      guardian_phone,
      mailing_address_optional: mailing_address_optional || '',
      recipient_name_optional: recipient_name_optional || '',
      recipient_phone_optional: recipient_phone_optional || '',
      updated_at: db.serverDate(),
    };

    // IMPORTANT: UI does not preload id_number on edit for privacy.
    // Do NOT overwrite encrypted ID unless user provides id_number.
    if (id_number) {
      data.id_number_encrypted = encrypt(id_number);
      data.id_last4 = getLast4(id_number);
    }

    if (learner_id) {
      // Update - verify ownership
      const existing = await db.collection('learners').doc(learner_id).get();
      if (existing.data.household_id !== household._id) {
        return fail('Not your learner', 'FORBIDDEN');
      }
      // If id_number not provided, keep existing encrypted ID and last4
      if (!id_number) {
        delete data.id_number_encrypted;
        delete data.id_last4;
      }
      await db.collection('learners').doc(learner_id).update({ data });
      return success({ _id: learner_id });
    } else {
      // Create
      if (!id_number) return fail('id_number required', 'MISSING_ID_NUMBER');
      data.id_number_encrypted = encrypt(id_number);
      data.id_last4 = getLast4(id_number);
      data.household_id = household._id;
      data.created_at = db.serverDate();
      const res = await db.collection('learners').add({ data });
      return success({ _id: res._id });
    }
  } catch (err) {
    return fail(err.message);
  }
};
