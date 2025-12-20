const app = getApp();
import api from '../../../utils/api';

Page({
  data: { learners: [], loading: true },

  async onShow() {
    await app.ensureLogin(); // Wait for login first
    this.loadLearners();
  },

  async loadLearners() {
    this.setData({ loading: true });
    try {
      const learners = await api.learnerList();
      this.setData({ learners, loading: false });
    } catch (e) {
      console.error('Load learners failed:', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  goToAdd() {
    wx.navigateTo({ url: '/pages/learner/edit/edit' });
  },

  goToEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/learner/edit/edit?id=${id}` });
  },
});
