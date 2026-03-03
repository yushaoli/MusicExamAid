const app = getApp();

Page({
  data: {
    session: null,
    loading: true,
  },

  async onShow() {
    await app.ensureLogin();
    const session = app.getSession();
    this.setData({ session, loading: false });
  },

  goToLearners() {
    wx.navigateTo({ url: '/pages/learner/list/list' });
  },

  goToRegistrations() {
    wx.switchTab({ url: '/pages/registration/list/list' });
  },
});
