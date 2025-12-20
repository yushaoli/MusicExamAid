const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// Complete subject list based on 中国音乐学院 exam structure
const SUBJECTS = [
  // 键盘
  { subject_id: 'piano', subject_name: '钢琴', category: '键盘', max_level: 10, is_active: true },
  { subject_id: 'electronic_keyboard_single', subject_name: '电子琴(单排键)', category: '键盘', max_level: 10, is_active: true },
  { subject_id: 'electronic_keyboard_double', subject_name: '电子琴(双排键)', category: '键盘', max_level: 10, is_active: true },
  { subject_id: 'accordion', subject_name: '手风琴', category: '键盘', max_level: 9, is_active: true },
  { subject_id: 'digital_piano', subject_name: '数码钢琴', category: '键盘', max_level: 10, is_active: true },
  
  // 民族乐器 - 弹拨
  { subject_id: 'guzheng', subject_name: '古筝', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'erhu', subject_name: '二胡', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'pipa', subject_name: '琵琶', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'hulusi', subject_name: '葫芦丝', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'bawu', subject_name: '巴乌', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'zhongruan', subject_name: '中阮及大阮', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'sanxian', subject_name: '三弦', category: '民族乐器', max_level: 9, is_active: true },
  { subject_id: 'yangqin', subject_name: '扬琴', category: '民族乐器', max_level: 9, is_active: true },
  { subject_id: 'zhudi', subject_name: '竹笛', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'suona', subject_name: '唢呐', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'liuqin', subject_name: '柳琴', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'sheng', subject_name: '笙', category: '民族乐器', max_level: 10, is_active: true },
  { subject_id: 'national_percussion', subject_name: '民族打击乐器', category: '民族乐器', max_level: 9, is_active: true },
  { subject_id: 'xiao', subject_name: '箫', category: '民族乐器', max_level: 10, is_active: true },
  
  // 西洋乐器 - 弦乐
  { subject_id: 'violin', subject_name: '小提琴', category: '西洋弦乐', max_level: 10, is_active: true },
  { subject_id: 'viola', subject_name: '低音提琴', category: '西洋弦乐', max_level: 9, is_active: true },
  { subject_id: 'cello', subject_name: '大提琴', category: '西洋弦乐', max_level: 7, is_active: true },
  
  // 西洋乐器 - 管乐
  { subject_id: 'clarinet', subject_name: '单簧管', category: '西洋管乐', max_level: 10, is_active: true },
  { subject_id: 'flute', subject_name: '长笛', category: '西洋管乐', max_level: 10, is_active: true },
  { subject_id: 'trumpet', subject_name: '小号', category: '西洋管乐', max_level: 10, is_active: true },
  { subject_id: 'saxophone', subject_name: '萨克斯管', category: '西洋管乐', max_level: 10, is_active: true },
  { subject_id: 'trombone', subject_name: '长号', category: '西洋管乐', max_level: 10, is_active: true },
  { subject_id: 'horn', subject_name: '圆号', category: '西洋管乐', max_level: 10, is_active: true },
  { subject_id: 'euphonium', subject_name: '次中音号(上低音号)', category: '西洋管乐', max_level: 9, is_active: true },
  { subject_id: 'tuba', subject_name: '大号', category: '西洋管乐', max_level: 10, is_active: true },
  
  // 打击乐
  { subject_id: 'drum_kit', subject_name: '爵士鼓(电鼓/架子鼓)', category: '打击乐', max_level: 10, is_active: true },
  { subject_id: 'snare_drum', subject_name: '小军鼓', category: '打击乐', max_level: 10, is_active: true },
  { subject_id: 'marimba', subject_name: '打击乐(马林巴)', category: '打击乐', max_level: 9, is_active: true },
  
  // 吉他
  { subject_id: 'folk_guitar', subject_name: '民谣吉他', category: '吉他', max_level: 10, is_active: true },
  { subject_id: 'classical_guitar', subject_name: '古典吉他', category: '吉他', max_level: 10, is_active: true },
  
  // 声乐
  { subject_id: 'vocal_ethnic', subject_name: '民族唱法', category: '声乐', max_level: 10, is_active: true },
  { subject_id: 'vocal_pop', subject_name: '通俗唱法', category: '声乐', max_level: 10, is_active: true },
  { subject_id: 'vocal_art', subject_name: '美声唱法', category: '声乐', max_level: 10, is_active: true },
  { subject_id: 'vocal_children', subject_name: '少儿歌唱', category: '声乐', max_level: 10, is_active: true },
  
  // 朗诵
  { subject_id: 'recitation', subject_name: '朗诵', category: '朗诵', max_level: 10, is_active: true },
  
  // 音乐基础知识
  { subject_id: 'music_theory', subject_name: '音乐基础知识', category: '基础', max_level: 6, is_active: true },
];

const CYCLES = [
  { cycle_id: '2025-spring', display_name: '2025年春季考期', start_date: '2025-03-01', end_date: '2025-05-31' },
  { cycle_id: '2025-summer', display_name: '2025年暑期考期', start_date: '2025-07-01', end_date: '2025-08-31' },
  { cycle_id: '2025-fall', display_name: '2025年秋季考期', start_date: '2025-09-01', end_date: '2025-11-30' },
  { cycle_id: '2025-winter', display_name: '2025年冬季考期', start_date: '2025-12-01', end_date: '2026-02-28' },
];

// Sample repertoire by instrument and level
const REPERTOIRE_SAMPLES = {
  piano: {
    3: ['车尔尼练习曲 Op.599 No.50', '小奏鸣曲 Op.36 No.1 第一乐章', '中外乐曲一首(自选)'],
    5: ['车尔尼练习曲 Op.299 No.10', '巴赫二部创意曲 No.8', '莫扎特奏鸣曲 K.545 第一乐章', '中国乐曲一首(自选)'],
    7: ['车尔尼练习曲 Op.299 No.29', '巴赫三部创意曲 No.6', '贝多芬奏鸣曲 Op.49 No.2', '中国乐曲一首(自选)'],
    10: ['肖邦练习曲 Op.10 No.5', '巴赫平均律 BWV 846', '贝多芬奏鸣曲 Op.13 悲怆', '中国乐曲一首(自选)'],
  },
  guzheng: {
    3: ['练习曲一首(自选)', '乐曲一首(自选)', '乐曲二首(自选)'],
    5: ['练习曲一首(自选)', '乐曲一《渔舟唱晚》', '乐曲二《高山流水》', '乐曲三(自选)'],
    8: ['练习曲一首(自选)', '乐曲一《战台风》', '乐曲二《林冲夜奔》', '乐曲三(自选)'],
    10: ['练习曲一首(自选)', '乐曲一《幻想曲》', '乐曲二(自选)', '乐曲三(自选)'],
  },
  erhu: {
    3: ['练习曲一首(自选)', '乐曲《良宵》', '乐曲(自选)'],
    5: ['练习曲一首(自选)', '乐曲《赛马》', '乐曲《听松》', '乐曲(自选)'],
    8: ['练习曲一首(自选)', '乐曲《二泉映月》', '乐曲《江河水》', '乐曲(自选)'],
    10: ['练习曲一首(自选)', '乐曲《长城随想》第一乐章', '乐曲(自选)', '乐曲(自选)'],
  },
  violin: {
    3: ['音阶琶音', '练习曲一首', '乐曲一首(自选)', '协奏曲(自选)'],
    5: ['音阶琶音', '练习曲一首', '乐曲《新春乐》', '外国乐曲(自选)'],
    8: ['音阶琶音', '练习曲一首', '乐曲一首', '协奏曲一乐章'],
    10: ['音阶琶音', '练习曲一首', '乐曲一首', '协奏曲(自选两乐章)'],
  },
  vocal_children: {
    3: ['乐曲(规定)', '乐曲(自选)'],
    5: ['乐曲一首', '乐曲二首', '乐曲(自选)'],
    8: ['乐曲一首', '乐曲二首', '乐曲三首', '乐曲(自选)'],
  },
  flute: {
    3: ['音阶琶音', '练习曲一首', '乐曲(自选)', '乐曲(第一首必选)'],
    5: ['音阶琶音', '练习曲一首', '乐曲(自选)', '乐曲(自选)'],
    8: ['音阶琶音', '练习曲一首', '乐曲一首', '中国乐曲(自选)'],
  },
  saxophone: {
    3: ['音阶琶音', '练习曲一首', '乐曲(自选)'],
    5: ['音阶大小调', '练习曲一首', '乐曲(自选)', '中国乐曲(自选)'],
    8: ['音阶大小调', '练习曲一首', '乐曲一首', '外国乐曲(自选)'],
  },
  drum_kit: {
    3: ['练习曲一首(自选)', '乐曲一首(自选)'],
    5: ['练习曲一首(自选)', '乐曲一首', '练习曲四(自选)'],
    8: ['练习曲一首', '独奏曲一首', '独奏曲二首'],
  },
};

// Sample learners data
const SAMPLE_LEARNERS = [
  {
    name_cn: '张小明',
    name_en_optional: 'Zhang Xiaoming',
    gender: '男',
    dob: '2015-06-15',
    nationality: '中国',
    ethnicity_optional: '汉族',
    id_type: '身份证',
    id_number_encrypted: 'enc_110101201506150011',
    id_last4: '0011',
    guardian_phone: '13800138001',
    subject: 'piano',
    level: 5,
  },
  {
    name_cn: '李小红',
    name_en_optional: 'Li Xiaohong',
    gender: '女',
    dob: '2014-03-22',
    nationality: '中国',
    ethnicity_optional: '汉族',
    id_type: '身份证',
    id_number_encrypted: 'enc_110101201403220022',
    id_last4: '0022',
    guardian_phone: '13800138002',
    subject: 'guzheng',
    level: 8,
  },
  {
    name_cn: '王小华',
    name_en_optional: 'Wang Xiaohua',
    gender: '男',
    dob: '2016-09-10',
    nationality: '中国',
    ethnicity_optional: '满族',
    id_type: '身份证',
    id_number_encrypted: 'enc_110101201609100033',
    id_last4: '0033',
    guardian_phone: '13800138003',
    subject: 'violin',
    level: 3,
  },
  {
    name_cn: '陈小芳',
    name_en_optional: 'Chen Xiaofang',
    gender: '女',
    dob: '2013-12-05',
    nationality: '中国',
    ethnicity_optional: '汉族',
    id_type: '身份证',
    id_number_encrypted: 'enc_110101201312050044',
    id_last4: '0044',
    guardian_phone: '13800138004',
    subject: 'erhu',
    level: 5,
  },
  {
    name_cn: '刘小强',
    name_en_optional: 'Liu Xiaoqiang',
    gender: '男',
    dob: '2012-07-18',
    nationality: '中国',
    ethnicity_optional: '汉族',
    id_type: '身份证',
    id_number_encrypted: 'enc_110101201207180055',
    id_last4: '0055',
    guardian_phone: '13800138005',
    subject: 'saxophone',
    level: 5,
  },
  {
    name_cn: '赵小雪',
    name_en_optional: 'Zhao Xiaoxue',
    gender: '女',
    dob: '2015-01-28',
    nationality: '中国',
    ethnicity_optional: '回族',
    id_type: '身份证',
    id_number_encrypted: 'enc_110101201501280066',
    id_last4: '0066',
    guardian_phone: '13800138006',
    subject: 'vocal_children',
    level: 5,
  },
];

function getRepertoire(subject, level) {
  const subjectRep = REPERTOIRE_SAMPLES[subject];
  if (!subjectRep) {
    return ['练习曲一首(自选)', '乐曲一首(自选)', '乐曲二首(自选)'];
  }
  // Find closest level
  const levels = Object.keys(subjectRep).map(Number).sort((a, b) => a - b);
  let closest = levels[0];
  for (const l of levels) {
    if (l <= level) closest = l;
  }
  return subjectRep[closest] || ['练习曲一首(自选)', '乐曲一首(自选)'];
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const results = { created: [], skipped: [] };

  try {
    // 1. Seed dict_subjects
    for (const subject of SUBJECTS) {
      const existing = await db.collection('dict_subjects').where({ subject_id: subject.subject_id }).get();
      if (existing.data.length === 0) {
        await db.collection('dict_subjects').add({ data: subject });
        results.created.push(`subject: ${subject.subject_name}`);
      }
    }

    // 2. Seed dict_cycles
    for (const cycle of CYCLES) {
      const existing = await db.collection('dict_cycles').where({ cycle_id: cycle.cycle_id }).get();
      if (existing.data.length === 0) {
        await db.collection('dict_cycles').add({ data: cycle });
        results.created.push(`cycle: ${cycle.display_name}`);
      }
    }

    // 3. Create/get household for current user
    let householdRes = await db.collection('households').where({ openid }).get();
    let household = householdRes.data[0];
    if (!household) {
      const h = await db.collection('households').add({
        data: { openid, created_at: db.serverDate() }
      });
      household = { _id: h._id };
      results.created.push('household');
    }

    // 4. Create sample institutions
    const institutions = [
      { name: '北京示范音乐学校', legacy_org_id: '10001' },
      { name: '上海艺术培训中心', legacy_org_id: '10002' },
    ];
    const instMap = {};
    for (const inst of institutions) {
      let instRes = await db.collection('institutions').where({ legacy_org_id: inst.legacy_org_id }).get();
      if (instRes.data.length === 0) {
        const i = await db.collection('institutions').add({
          data: { ...inst, created_at: db.serverDate() }
        });
        instMap[inst.legacy_org_id] = i._id;
        results.created.push(`institution: ${inst.name}`);
      } else {
        instMap[inst.legacy_org_id] = instRes.data[0]._id;
      }
    }
    const mainInstId = instMap['10001'];

    // 5. Create sample learners with enrollments and registrations
    for (const learnerData of SAMPLE_LEARNERS) {
      // Check if learner exists
      let learnerRes = await db.collection('learners').where({ 
        household_id: household._id,
        name_cn: learnerData.name_cn 
      }).get();
      
      let learnerId;
      if (learnerRes.data.length === 0) {
        const l = await db.collection('learners').add({
          data: {
            household_id: household._id,
            name_cn: learnerData.name_cn,
            name_en_optional: learnerData.name_en_optional,
            gender: learnerData.gender,
            dob: learnerData.dob,
            nationality: learnerData.nationality,
            ethnicity_optional: learnerData.ethnicity_optional,
            id_type: learnerData.id_type,
            id_number_encrypted: learnerData.id_number_encrypted,
            id_last4: learnerData.id_last4,
            guardian_phone: learnerData.guardian_phone,
            mailing_address_optional: '北京市朝阳区示范路100号',
            recipient_name_optional: learnerData.name_cn.slice(0, 1) + '家长',
            recipient_phone_optional: learnerData.guardian_phone,
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
        learnerId = l._id;
        results.created.push(`learner: ${learnerData.name_cn}`);
      } else {
        learnerId = learnerRes.data[0]._id;
        results.skipped.push(`learner: ${learnerData.name_cn}`);
      }

      // Create enrollment
      let enrollRes = await db.collection('enrollments').where({ 
        learner_id: learnerId, 
        class_id: mainInstId 
      }).get();
      if (enrollRes.data.length === 0) {
        await db.collection('enrollments').add({
          data: {
            learner_id: learnerId,
            class_id: mainInstId,
            consent_status: 'Granted',
            created_at: db.serverDate()
          }
        });
        results.created.push(`enrollment: ${learnerData.name_cn}`);
      }

      // Create registration
      let regRes = await db.collection('registrations').where({ 
        learner_id: learnerId,
        cycle_id: '2025-summer',
        subject_id: learnerData.subject
      }).get();
      if (regRes.data.length === 0) {
        const repertoire = getRepertoire(learnerData.subject, learnerData.level);
        await db.collection('registrations').add({
          data: {
            learner_id: learnerId,
            class_id: mainInstId,
            cycle_id: '2025-summer',
            subject_id: learnerData.subject,
            level: learnerData.level,
            exam_mode: '现场',
            exam_site_id_optional: '',
            repertoire: repertoire,
            application_status: '未申请',
            workflow_status: 'Draft',
            teacher_notes: '',
            handoff_status: 'None',
            snapshot_json: null,
            missing_flags: [],
            submitted_at: null,
            confirmed_at: null,
            locked_at: null,
            updated_at: db.serverDate()
          }
        });
        results.created.push(`registration: ${learnerData.name_cn} - ${learnerData.subject} L${learnerData.level}`);
      }
    }

    // 6. Create teacher account and profile for current user
    let teacherAccRes = await db.collection('teacher_accounts').where({ openid }).get();
    let teacherAccount = teacherAccRes.data[0];
    if (!teacherAccount) {
      const ta = await db.collection('teacher_accounts').add({
        data: { openid, created_at: db.serverDate() }
      });
      teacherAccount = { _id: ta._id };
      results.created.push('teacher_account');
    }

    let profileRes = await db.collection('teacher_profiles').where({ 
      teacher_account_id: teacherAccount._id 
    }).get();
    if (profileRes.data.length === 0) {
      await db.collection('teacher_profiles').add({
        data: {
          class_id: mainInstId,
          teacher_account_id: teacherAccount._id,
          teacher_name: '王老师',
          teacher_phone_optional: '13900139000',
          role: 'Super',
          can_export_optional: true,
          created_at: db.serverDate()
        }
      });
      results.created.push('teacher_profile (Super role)');
    }

    return { 
      success: true, 
      summary: {
        created: results.created.length,
        skipped: results.skipped.length,
        subjects: SUBJECTS.length,
        learners: SAMPLE_LEARNERS.length,
      },
      details: results
    };
  } catch (err) {
    return { success: false, error: err.message, stack: err.stack };
  }
};
