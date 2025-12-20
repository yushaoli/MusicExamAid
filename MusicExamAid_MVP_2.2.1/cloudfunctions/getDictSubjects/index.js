const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail } = require('../shared');

exports.main = async () => {
  try {
    const res = await db.collection('dict_subjects')
      .where({ is_active: true })
      .orderBy('subject_id', 'asc')
      .get();
    return success(res.data);
  } catch (err) {
    return fail(err.message);
  }
};
