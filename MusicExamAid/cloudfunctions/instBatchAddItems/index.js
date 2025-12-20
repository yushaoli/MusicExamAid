const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireAdmin, requireClassAccess } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireAdmin(ctx);

    const { batch_id, reg_ids } = event;

    const batch = await db.collection('institution_batches').doc(batch_id).get();
    requireClassAccess(ctx, batch.data.class_id);

    if (batch.data.inst_batch_status !== 'Draft') {
      return fail('Batch is not in Draft status', 'INVALID_STATUS');
    }

    // Verify all registrations are eligible
    const regsRes = await db.collection('registrations')
      .where({ _id: _.in(reg_ids) })
      .get();

    const errors = [];
    for (const reg of regsRes.data) {
      if (reg.class_id !== batch.data.class_id) {
        errors.push(`${reg._id}: wrong class`);
      } else if (reg.workflow_status !== 'Locked') {
        errors.push(`${reg._id}: not locked`);
      } else if (reg.handoff_status !== 'SubmittedToInstitution') {
        errors.push(`${reg._id}: not submitted to institution`);
      }
    }

    if (errors.length > 0) {
      return fail('Some registrations not eligible: ' + errors.join('; '), 'INELIGIBLE');
    }

    // Add items
    const addPromises = reg_ids.map(reg_id =>
      db.collection('institution_batch_items').add({
        data: { inst_batch_id: batch_id, reg_id, created_at: db.serverDate() }
      })
    );
    await Promise.all(addPromises);

    // Update handoff_status
    await db.collection('registrations')
      .where({ _id: _.in(reg_ids) })
      .update({ data: { handoff_status: 'IncludedInInstitutionBatch' } });

    return success({ added: reg_ids.length });
  } catch (err) {
    return fail(err.message);
  }
};

