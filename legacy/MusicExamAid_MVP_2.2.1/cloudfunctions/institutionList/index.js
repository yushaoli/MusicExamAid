const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { success, fail, getAuthContext, requireParent } = require('../shared');

exports.main = async () => {
  try {
    const ctx = await getAuthContext(db);
    requireParent(ctx);

    const res = await db.collection('institutions')
      .orderBy('name', 'asc')
      .limit(200)
      .get();

    return success(res.data.map(i => ({
      _id: i._id,
      name: i.name,
      legacy_org_id: i.legacy_org_id || '',
    })));
  } catch (err) {
    return fail(err.message);
  }
};
