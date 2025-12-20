const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    loading: true,
    cycles: [],
    cycleIndex: 0,
    incoming: [],
    selectedInstBatches: [],
    superBatchId: '',
  },

  async onShow() {
    await app.ensureLogin();
    await this.bootstrap();
    await this.load();
  },

  async bootstrap() {
    const cycles = await api.getDictCycles();
    this.setData({ cycles });
  },

  onCycleChange(e) {
    this.setData({ cycleIndex: Number(e.detail.value) });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const cycle_id = this.data.cycles[this.data.cycleIndex]?.cycle_id;
      const incoming = await api.superIncomingInstBatchesList({ cycle_id });
      this.setData({ incoming, loading: false, selectedInstBatches: [] });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onSelectIncoming(e) {
    this.setData({ selectedInstBatches: e.detail.value });
  },

  async onCreateSuperBatch() {
    const cycle_id = this.data.cycles[this.data.cycleIndex]?.cycle_id;
    if (!cycle_id) return;
    try {
      const res = await api.superBatchCreate({ cycle_id });
      this.setData({ superBatchId: res._id });
      wx.showToast({ title: '已创建汇总批次', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
    }
  },

  async onIngest() {
    const { superBatchId, selectedInstBatches } = this.data;
    if (!superBatchId) {
      wx.showToast({ title: '请先创建汇总批次', icon: 'none' });
      return;
    }
    if (!selectedInstBatches.length) {
      wx.showToast({ title: '请选择机构批次', icon: 'none' });
      return;
    }

    try {
      await api.superBatchIngestInstitutionBatches(superBatchId, selectedInstBatches);
      wx.showToast({ title: '已导入', icon: 'success' });
      setTimeout(() => wx.navigateTo({ url: `/pages/super/batch/batch?id=${superBatchId}` }), 600);
    } catch (e) {
      wx.showToast({ title: e.message || '导入失败', icon: 'none' });
    }
  },
});
