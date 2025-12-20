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

    // Get learners for this household
    const learnersRes = await db.collection('learners')
      .where({ household_id: household._id })
      .get();
    const learnerIds = learnersRes.data.map(l => l._id);

    if (learnerIds.length === 0) {
      return success([]);
    }

    // Get registrations for these learners
    const regsRes = await db.collection('registrations')
      .where({ learner_id: db.command.in(learnerIds) })
      .orderBy('updated_at', 'desc')
      .get();

    return success(regsRes.data);
  } catch (err) {
    return fail(err.message);
  }
};

