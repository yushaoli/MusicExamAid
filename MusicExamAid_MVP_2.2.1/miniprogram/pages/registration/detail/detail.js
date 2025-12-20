const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    id: null,
    reg: null,
    loading: true,
  },

  async onLoad(options) {
    await app.ensureLogin();
    this.setData({ id: options.id });
    await this.load();
  },

  async onShow() {
    if (this.data.id) await this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const reg = await api.registrationGet(this.data.id);
      this.setData({ reg, loading: false });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  goEdit() {
    wx.navigateTo({ url: `/pages/registration/edit/edit?id=${this.data.id}` });
  },

  async onSubmit() {
    try {
      await api.registrationSubmit(this.data.id);
      wx.showToast({ title: '已提交', icon: 'success' });
      this.load();
    } catch (e) {
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    }
  },

  async onUploadPortrait() {
    const reg = this.data.reg;
    if (!reg) return;

    try {
      const choose = await wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'] });
      const filePath = choose.tempFilePaths[0];

      wx.showLoading({ title: '上传中...' });
      const up = await wx.cloud.uploadFile({
        cloudPath: `attachments/portrait_${reg.learner_id}_${Date.now()}.jpg`,
        filePath,
      });

      await api.attachmentCommit({
        owner_type: 'learner',
        owner_id: reg.learner_id,
        file_type: 'portrait_photo',
        cloud_file_id: up.fileID,
      });

      wx.hideLoading();
      wx.showToast({ title: '已上传', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      console.error(e);
      wx.showToast({ title: e.message || '上传失败', icon: 'none' });
    }
  },
});
