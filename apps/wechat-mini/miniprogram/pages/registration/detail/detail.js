const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    id: null,
    reg: null,
    loading: true,
    previewLoading: false,
    checkoutPreview: null,
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
    const request = this.previewRequest = (this.previewRequest || 0) + 1;
    this.setData({ loading: true, reg: null, checkoutPreview: null, previewLoading: false });
    try {
      const reg = await api.registrationGet(this.data.id);
      if (request !== this.previewRequest) return;
      this.setData({ reg, loading: false });
    } catch (e) {
      if (request !== this.previewRequest) return;
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async onPreviewCheckout() {
    if (this.data.loading || !this.data.reg || this.data.previewLoading) return;
    const request = this.previewRequest = (this.previewRequest || 0) + 1;
    this.setData({ previewLoading: true, checkoutPreview: null });
    try {
      const preview = await api.paymentCheckoutPreview(this.data.id);
      if (request !== this.previewRequest) return;
      this.setData({ checkoutPreview: preview });
    } catch (e) {
      if (request !== this.previewRequest) return;
      wx.showToast({ title: '费用暂不可用，请稍后重试', icon: 'none' });
    } finally {
      if (request === this.previewRequest) this.setData({ previewLoading: false });
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

});
