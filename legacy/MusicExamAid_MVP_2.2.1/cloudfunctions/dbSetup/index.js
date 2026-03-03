const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// Collections to create
const COLLECTIONS = [
  'households',
  'learners', 
  'institutions',
  'teacher_accounts',
  'teacher_profiles',
  'enrollments',
  'registrations',
  'attachments',
  'audit_logs',
  'institution_batches',
  'institution_batch_items',
  'super_batches',
  'super_batch_items',
  'export_logs',
  'dict_subjects',
  'dict_cycles'
];

// Seed data
const SUBJECTS = [
  { subject_id: 'piano', subject_name: '钢琴', max_level: 10, is_active: true },
  { subject_id: 'violin', subject_name: '小提琴', max_level: 10, is_active: true },
  { subject_id: 'guzheng', subject_name: '古筝', max_level: 10, is_active: true },
  { subject_id: 'erhu', subject_name: '二胡', max_level: 10, is_active: true },
  { subject_id: 'pipa', subject_name: '琵琶', max_level: 10, is_active: true },
  { subject_id: 'flute', subject_name: '长笛', max_level: 10, is_active: true },
  { subject_id: 'clarinet', subject_name: '单簧管', max_level: 10, is_active: true },
  { subject_id: 'saxophone', subject_name: '萨克斯', max_level: 10, is_active: true },
  { subject_id: 'guitar', subject_name: '吉他', max_level: 10, is_active: true },
  { subject_id: 'vocal', subject_name: '声乐', max_level: 10, is_active: true },
  { subject_id: 'music_theory', subject_name: '音乐基础知识', max_level: 3, is_active: true },
];

const CYCLES = [
  { cycle_id: '2025-spring', display_name: '2025年春季考期', start_date: '2025-03-01', end_date: '2025-05-31' },
  { cycle_id: '2025-summer', display_name: '2025年暑期考期', start_date: '2025-07-01', end_date: '2025-08-31' },
  { cycle_id: '2025-fall', display_name: '2025年秋季考期', start_date: '2025-09-01', end_date: '2025-11-30' },
  { cycle_id: '2025-winter', display_name: '2025年冬季考期', start_date: '2025-12-01', end_date: '2026-02-28' },
];

exports.main = async (event, context) => {
  const results = { collections: [], subjects: 0, cycles: 0 };

  try {
    // Note: Collections must be created via Cloud Console
    // This function seeds the dictionary data
    results.collections = COLLECTIONS;
    results.note = 'Create these collections manually in Cloud Console first';

    // Seed subjects
    for (const subject of SUBJECTS) {
      const existing = await db.collection('dict_subjects').where({ subject_id: subject.subject_id }).get();
      if (existing.data.length === 0) {
        await db.collection('dict_subjects').add({ data: subject });
        results.subjects++;
      }
    }

    // Seed cycles  
    for (const cycle of CYCLES) {
      const existing = await db.collection('dict_cycles').where({ cycle_id: cycle.cycle_id }).get();
      if (existing.data.length === 0) {
        await db.collection('dict_cycles').add({ data: cycle });
        results.cycles++;
      }
    }

    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

