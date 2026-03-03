import api from '../../../utils/api';
Page({
  data: { id: null, reg: null },
  onLoad(options) { this.setData({ id: options.id }); this.load(); },
  async load() {
    const reg = await api.teacherRegistrationGetDetail(this.data.id);
    this.setData({ reg });
  },
  async onConfirm() {
    await api.teacherConfirm(this.data.id);
    wx.showToast({ title: '已确认' }); this.load();
  },
  async onLock() {
    try {
      await api.teacherLock(this.data.id);
      wx.showToast({ title: '已锁定' }); this.load();
    } catch (e) { wx.showToast({ title: e.message, icon: 'none' }); }
  },
  async onSubmitToInst() {
    await api.teacherSubmitToInstitution(this.data.id);
    wx.showToast({ title: '已提交机构' }); this.load();
  },
});

