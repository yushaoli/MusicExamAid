const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireTeacher, requireClassAccess } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireTeacher(ctx);

    const { reg_id } = event;
    if (!reg_id) return fail('reg_id required', 'MISSING_REG_ID');

    const regRes = await db.collection('registrations').doc(reg_id).get();
    const reg = regRes.data;
    requireClassAccess(ctx, reg.class_id);

    const learnerRes = await db.collection('learners').doc(reg.learner_id).get();
    const learner = learnerRes.data;

    return success({
      ...reg,
      learner_name: learner?.name_cn || '',
      learner_last4: learner?.id_last4 || '',
    });
  } catch (err) {
    return fail(err.message);
  }
};
