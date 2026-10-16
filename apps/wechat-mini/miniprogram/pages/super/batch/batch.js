const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    id: null,
    loading: true,
    batch: null,
    items: [],
    selectedItems: [],
    preflight: null,
    exportResult: null,
  },

  async onLoad(options) {
    await app.ensureLogin();
    this.setData({ id: options.id });
    await this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const data = await api.superBatchGet(this.data.id);
      this.setData({ batch: data.batch, items: data.items, loading: false, selectedItems: [], preflight: null });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onSelectItems(e) {
    this.setData({ selectedItems: e.detail.value });
  },

  async onExcludeSelected() {
    if (!this.data.selectedItems.length) {
      wx.showToast({ title: '请选择条目', icon: 'none' });
      return;
    }
    try {
      await Promise.all(this.data.selectedItems.map(id => api.superBatchResolveConflict(id, 'exclude')));
      wx.showToast({ title: '已排除', icon: 'success' });
      this.load();
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },

  async onIncludeSelected() {
    if (!this.data.selectedItems.length) {
      wx.showToast({ title: '请选择条目', icon: 'none' });
      return;
    }
    try {
      await Promise.all(this.data.selectedItems.map(id => api.superBatchResolveConflict(id, 'include')));
      wx.showToast({ title: '已包含', icon: 'success' });
      this.load();
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },

  async onDedup() {
    try {
      const res = await api.superBatchDedupRun(this.data.id);
      wx.showToast({ title: `自动处理 ${res.auto_resolved} 条`, icon: 'success' });
      this.load();
    } catch (e) {
      wx.showToast({ title: e.message || '去重失败', icon: 'none' });
    }
  },

  async onPreflight() {
    try {
      const preflight = await api.superBatchPreflight(this.data.id);
      this.setData({ preflight });
    } catch (e) {
      wx.showToast({ title: e.message || '校验失败', icon: 'none' });
    }
  },

  async onExport() {
    try {
      const exportResult = await api.superBatchExportOnce(this.data.id);
      this.setData({ exportResult });
      wx.showToast({ title: '已导出', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '导出失败', icon: 'none' });
    }
  },
});
