const app = getApp();
import api from '../../../utils/api';

Page({
  data: { registrations: [], loading: true },

  async onShow() {
    await app.ensureLogin();
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const registrations = await api.registrationList();
      this.setData({ registrations, loading: false });
    } catch (e) {
      console.error('Load registrations failed:', e);
      this.setData({ loading: false });
    }
  },

  goToCreate() {
    wx.navigateTo({ url: '/pages/registration/edit/edit' });
  },

  goToDetail(e) {
    wx.navigateTo({ url: `/pages/registration/detail/detail?id=${e.currentTarget.dataset.id}` });
  },
});
