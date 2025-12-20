const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    id: null,
    loading: true,
    learners: [],
    subjects: [],
    cycles: [],
    form: {
      learner_id: '',
      cycle_id: '',
      subject_id: '',
      level: '',
      exam_mode: '现场',
      repertoire0: '',
      repertoire1: '',
    },
    learnerIndex: 0,
    cycleIndex: 0,
    subjectIndex: 0,
    examModeOptions: ['现场', '线上'],
    examModeIndex: 0,
  },

  async onLoad(options) {
    await app.ensureLogin();
    const id = options.id || null;
    this.setData({ id });
    await this.bootstrap();
    if (id) await this.loadReg(id);
    this.setData({ loading: false });
  },

  async bootstrap() {
    const [learners, subjects, cycles] = await Promise.all([
      api.learnerList(),
      api.getDictSubjects(),
      api.getDictCycles(),
    ]);
    this.setData({ learners, subjects, cycles });

    if (learners.length && !this.data.form.learner_id) {
      this.setData({ 'form.learner_id': learners[0]._id, learnerIndex: 0 });
    }
    if (cycles.length && !this.data.form.cycle_id) {
      this.setData({ 'form.cycle_id': cycles[0].cycle_id, cycleIndex: 0 });
    }
    if (subjects.length && !this.data.form.subject_id) {
      this.setData({ 'form.subject_id': subjects[0].subject_id, subjectIndex: 0 });
    }
  },

  async loadReg(id) {
    const reg = await api.registrationGet(id);
    const repertoire0 = Array.isArray(reg.repertoire) ? (reg.repertoire[0] || '') : '';
    const repertoire1 = Array.isArray(reg.repertoire) ? (reg.repertoire[1] || '') : '';

    const learnerIndex = Math.max(0, this.data.learners.findIndex(x => x._id === reg.learner_id));
    const cycleIndex = Math.max(0, this.data.cycles.findIndex(x => x.cycle_id === reg.cycle_id));
    const subjectIndex = Math.max(0, this.data.subjects.findIndex(x => x.subject_id === reg.subject_id));
    const examModeIndex = Math.max(0, this.data.examModeOptions.findIndex(x => x === (reg.exam_mode || '现场')));

    this.setData({
      form: {
        learner_id: reg.learner_id,
        cycle_id: reg.cycle_id,
        subject_id: reg.subject_id,
        level: reg.level,
        exam_mode: reg.exam_mode || '现场',
        repertoire0,
        repertoire1,
      },
      learnerIndex,
      cycleIndex,
      subjectIndex,
      examModeIndex,
    });
  },

  onLearnerChange(e) {
    const i = Number(e.detail.value);
    this.setData({ learnerIndex: i, 'form.learner_id': this.data.learners[i]._id });
  },

  onCycleChange(e) {
    const i = Number(e.detail.value);
    this.setData({ cycleIndex: i, 'form.cycle_id': this.data.cycles[i].cycle_id });
  },

  onSubjectChange(e) {
    const i = Number(e.detail.value);
    this.setData({ subjectIndex: i, 'form.subject_id': this.data.subjects[i].subject_id });
  },

  onExamModeChange(e) {
    const i = Number(e.detail.value);
    this.setData({ examModeIndex: i, 'form.exam_mode': this.data.examModeOptions[i] });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async onSave() {
    const { id, form } = this.data;
    if (!form.learner_id || !form.cycle_id) {
      wx.showToast({ title: '请选择考生与考期', icon: 'none' });
      return;
    }

    const repertoire = [form.repertoire0, form.repertoire1].filter(x => !!x);

    try {
      let savedId = id;
      if (!id) {
        const res = await api.registrationCreate({
          learner_id: form.learner_id,
          cycle_id: form.cycle_id,
          subject_id: form.subject_id,
          level: form.level,
          exam_mode: form.exam_mode,
          repertoire,
        });
        savedId = res._id;
      } else {
        await api.registrationUpdate({
          reg_id: id,
          subject_id: form.subject_id,
          level: form.level,
          exam_mode: form.exam_mode,
          repertoire,
        });
      }

      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/registration/detail/detail?id=${savedId}` });
      }, 600);
    } catch (e) {
      console.error(e);
      const msg = e.message || '保存失败';
      wx.showToast({ title: msg, icon: 'none' });
      if (String(msg).includes('No enrollment') || String(msg).includes('enrollment')) {
        setTimeout(() => wx.navigateTo({ url: '/pages/enrollment/select/select' }), 800);
      }
    }
  },
});
