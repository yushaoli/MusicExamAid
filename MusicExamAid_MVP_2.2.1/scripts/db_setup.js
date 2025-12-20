/**
 * Database Setup Script
 * Run this via cloud function or locally with admin SDK
 * 
 * Usage: Deploy as a cloud function named "dbSetup" and call once
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// Seed data for dict_subjects
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

// Seed data for dict_cycles
const CYCLES = [
  { cycle_id: '2025-spring', display_name: '2025年春季考期', start_date_optional: '2025-03-01', end_date_optional: '2025-05-31' },
  { cycle_id: '2025-summer', display_name: '2025年暑期考期', start_date_optional: '2025-07-01', end_date_optional: '2025-08-31' },
  { cycle_id: '2025-fall', display_name: '2025年秋季考期', start_date_optional: '2025-09-01', end_date_optional: '2025-11-30' },
  { cycle_id: '2025-winter', display_name: '2025年冬季考期', start_date_optional: '2025-12-01', end_date_optional: '2026-02-28' },
];

exports.main = async (event, context) => {
  const results = { subjects: 0, cycles: 0, indexes: [] };

  try {
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

    // Note: Indexes must be created via Cloud Console or CLI
    // Required indexes:
    results.indexes = [
      'learners: household_id (ascending)',
      'teacher_profiles: class_id (ascending)',
      'teacher_profiles: teacher_account_id (ascending)',
      'teacher_profiles: role (ascending)',
      'enrollments: learner_id + class_id (unique)',
      'registrations: class_id + cycle_id + workflow_status',
      'registrations: learner_id + cycle_id',
      'attachments: owner_type + owner_id',
    ];

    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

