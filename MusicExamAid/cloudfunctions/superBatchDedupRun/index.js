const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { success, fail, getAuthContext, requireSuper } = require('../shared');

exports.main = async (event, context) => {
  try {
    const ctx = await getAuthContext(db);
    requireSuper(ctx);

    const { super_batch_id } = event;

    const batch = await db.collection('super_batches').doc(super_batch_id).get();
    if (batch.data.super_batch_status !== 'Draft') {
      return fail('Batch must be in Draft status', 'INVALID_STATUS');
    }

    // Get all items
    const itemsRes = await db.collection('super_batch_items')
      .where({ super_batch_id })
      .get();

    // Group by dedup_key
    const groups = {};
    for (const item of itemsRes.data) {
      const key = item.dedup_key;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    const autoResolved = [];
    const conflicts = [];

    for (const [key, items] of Object.entries(groups)) {
      if (items.length === 1) continue;

      // Get registration details
      const regIds = items.map(i => i.reg_id);
      const regsRes = await db.collection('registrations')
        .where({ _id: _.in(regIds) })
        .get();
      const regMap = Object.fromEntries(regsRes.data.map(r => [r._id, r]));

      // Check if all same level
      const levels = [...new Set(items.map(i => regMap[i.reg_id]?.level))];
      
      if (levels.length === 1) {
        // Same level - auto keep newest locked_at
        const sorted = items.sort((a, b) => {
          const regA = regMap[a.reg_id];
          const regB = regMap[b.reg_id];
          return new Date(regB.locked_at) - new Date(regA.locked_at);
        });

        // Keep first (newest), exclude rest
        for (let i = 1; i < sorted.length; i++) {
          await db.collection('super_batch_items').doc(sorted[i]._id).update({
            data: {
              include_status: 'Excluded',
              excluded_reason_optional: 'auto_dedup_same_level',
            }
          });
          autoResolved.push(sorted[i]._id);
        }
      } else {
        // Different levels - manual conflict
        conflicts.push({ dedup_key: key, item_ids: items.map(i => i._id), levels });
      }
    }

    return success({ auto_resolved: autoResolved.length, conflicts });
  } catch (err) {
    return fail(err.message);
  }
};

