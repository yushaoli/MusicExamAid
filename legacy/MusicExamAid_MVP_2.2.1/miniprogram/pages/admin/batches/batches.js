const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    loading: true,
    batches: [],
    cycles: [],
    cycleIndex: 0,
    classOptions: [],
    classIndex: 0,
  },

  async onShow() {
    await app.ensureLogin();
    await this.bootstrap();
    await this.load();
  },

  async bootstrap() {
    const session = app.getSession();
    const classOptions = (session?.teacher_profiles || [])
      .filter(p => ['Admin','Super'].includes(p.role))
      .map(p => ({ class_id: p.class_id, label: `${p.class_id} (${p.role})` }));

    const cycles = await api.getDictCycles();

    this.setData({ classOptions, cycles });
  },

  onClassChange(e) { this.setData({ classIndex: Number(e.detail.value) }); this.load(); },
  onCycleChange(e) { this.setData({ cycleIndex: Number(e.detail.value) }); this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      const { classOptions, classIndex, cycles, cycleIndex } = this.data;
      const class_id = classOptions[classIndex]?.class_id;
      const cycle_id = cycles[cycleIndex]?.cycle_id;
      const batches = await api.instBatchList({ class_id, cycle_id });
      this.setData({ batches, loading: false });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async onCreate() {
    const { classOptions, classIndex, cycles, cycleIndex } = this.data;
    const class_id = classOptions[classIndex]?.class_id;
    const cycle_id = cycles[cycleIndex]?.cycle_id;
    if (!class_id || !cycle_id) {
      wx.showToast({ title: '请选择机构与考期', icon: 'none' });
      return;
    }

    try {
      const res = await api.instBatchCreate({ class_id, cycle_id });
      wx.showToast({ title: '已创建', icon: 'success' });
      setTimeout(() => wx.navigateTo({ url: `/pages/admin/batch-detail/batch-detail?id=${res._id}` }), 600);
    } catch (e) {
      console.error(e);
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/admin/batch-detail/batch-detail?id=${e.currentTarget.dataset.id}` });
  },
});
