const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireTeacher } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireTeacher(ctx);

    const { cycle_id, status, subject_id, level, only_issues } = event;

    // Build query - teacher can only see their classes
    let query = { class_id: _.in(ctx.classIds) };
    
    if (cycle_id) query.cycle_id = cycle_id;
    if (status && status.length > 0) query.workflow_status = _.in(status);
    if (subject_id) query.subject_id = subject_id;
    if (level) query.level = level;
    if (only_issues) {
      query.missing_flags = _.neq([]);
    }

    const regs = await db.collection('registrations')
      .where(query)
      .orderBy('updated_at', 'desc')
      .limit(100)
      .get();

    // Get learner names
    const learnerIds = [...new Set(regs.data.map(r => r.learner_id))];
    const learnersRes = await db.collection('learners')
      .where({ _id: _.in(learnerIds) })
      .get();
    const learnerMap = Object.fromEntries(learnersRes.data.map(l => [l._id, l]));

    const result = regs.data.map(r => ({
      _id: r._id,
      learner_id: r.learner_id,
      learner_name: learnerMap[r.learner_id]?.name_cn || '',
      class_id: r.class_id,
      cycle_id: r.cycle_id,
      subject_id: r.subject_id,
      level: r.level,
      workflow_status: r.workflow_status,
      handoff_status: r.handoff_status,
      missing_flags: r.missing_flags || [],
      updated_at: r.updated_at,
    }));

    return success(result);
  } catch (err) {
    return fail(err.message);
  }
};

