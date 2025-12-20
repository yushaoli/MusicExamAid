const app = getApp();

Page({
  data: {
    session: null,
    showTeacherMenu: false,
    showAdminMenu: false,
    showSuperMenu: false,
  },

  onShow() {
    const session = app.getSession();
    this.setData({
      session,
      showTeacherMenu: session?.isTeacher || false,
      showAdminMenu: session?.isAdmin || false,
      showSuperMenu: session?.isSuper || false,
    });
  },

  goToLearners() {
    wx.navigateTo({ url: '/pages/learner/list/list' });
  },

  // Teacher entry
  goToTeacherRoster() {
    if (!this.data.showTeacherMenu) return;
    wx.navigateTo({ url: '/pages/teacher/roster/roster' });
  },

  // Admin entry
  goToAdminBatches() {
    if (!this.data.showAdminMenu) return;
    wx.navigateTo({ url: '/pages/admin/batches/batches' });
  },

  // Super entry
  goToSuperIncoming() {
    if (!this.data.showSuperMenu) return;
    wx.navigateTo({ url: '/pages/super/incoming/incoming' });
  },

  goToSuperBatch() {
    if (!this.data.showSuperMenu) return;
    wx.navigateTo({ url: '/pages/super/batch/batch' });
  },
});

