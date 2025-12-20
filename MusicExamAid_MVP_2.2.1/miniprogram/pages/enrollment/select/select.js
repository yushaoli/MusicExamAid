const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    learners: [],
    institutions: [],
    cycles: [],
    selectedLearnerIndex: 0,
    selectedInstitutionIndex: 0,
    consent_status: 'Granted',
    loading: true,
  },

  async onShow() {
    await app.ensureLogin();
    await this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const [learners, institutions] = await Promise.all([
        api.learnerList(),
        api.institutionList(),
      ]);
      this.setData({ learners, institutions, loading: false });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onLearnerChange(e) {
    this.setData({ selectedLearnerIndex: Number(e.detail.value) });
  },

  onInstitutionChange(e) {
    this.setData({ selectedInstitutionIndex: Number(e.detail.value) });
  },

  async onSubmit() {
    const { learners, institutions, selectedLearnerIndex, selectedInstitutionIndex } = this.data;
    if (!learners.length) {
      wx.showToast({ title: '请先添加考生', icon: 'none' });
      return;
    }
    if (!institutions.length) {
      wx.showToast({ title: '请先在云数据库创建报名机构', icon: 'none' });
      return;
    }

    const learner = learners[selectedLearnerIndex];
    const inst = institutions[selectedInstitutionIndex];

    try {
      await api.enrollmentCreateOrUpdate({
        learner_id: learner._id,
        class_id: inst._id,
        consent_status: 'Granted',
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      console.error(e);
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },
});
