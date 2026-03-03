const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireParent } = require('../shared');

exports.main = async (event) => {
  try {
    const ctx = await getAuthContext(db);
    requireParent(ctx);

    const {
      learner_id,
      cycle_id,
      class_id: classIdFromEvent,
      subject_id,
      level,
      exam_mode,
      exam_site_id_optional,
      repertoire,
    } = event;

    if (!learner_id || !cycle_id) return fail('learner_id and cycle_id required', 'MISSING_FIELDS');

    const learnerRes = await db.collection('learners').doc(learner_id).get();
    if (learnerRes.data.household_id !== ctx.household_id) {
      return fail('Not your learner', 'FORBIDDEN');
    }

    let class_id = classIdFromEvent || '';
    if (!class_id) {
      const enrRes = await db.collection('enrollments')
        .where({ learner_id, consent_status: _.in(['Granted', 'Pending']) })
        .limit(1)
        .get();
      if (enrRes.data.length === 0) return fail('No enrollment found. Please select institution first.', 'NO_ENROLLMENT');
      class_id = enrRes.data[0].class_id;
    }

    const res = await db.collection('registrations').add({
      data: {
        learner_id,
        class_id,
        cycle_id,
        subject_id: subject_id || '',
        level: level || '',
        exam_mode: exam_mode || '现场',
        exam_site_id_optional: exam_site_id_optional || '',
        repertoire: repertoire || [],
        workflow_status: 'Draft',
        handoff_status: 'None',
        teacher_notes: '',
        snapshot_json: null,
        missing_flags: [],
        locked_at: null,
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
      }
    });

    return success({ _id: res._id });
  } catch (err) {
    return fail(err.message);
  }
};
