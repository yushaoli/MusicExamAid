const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    id: null,
    loading: true,
    batch: null,
    items: [],
    eligible: [],
    selectedToAdd: [],
    selectedToRemove: [],
    preflight: null,
  },

  async onLoad(options) {
    await app.ensureLogin();
    this.setData({ id: options.id });
    await this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const data = await api.instBatchGet(this.data.id);
      this.setData({ batch: data.batch, items: data.items, loading: false, selectedToAdd: [], selectedToRemove: [], preflight: null });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async loadEligible() {
    const { batch } = this.data;
    if (!batch) return;
    // reuse teacherRosterList because Admin is also Teacher in RBAC
    const regs = await api.teacherRosterList({
      cycle_id: batch.cycle_id,
      status: ['Locked'],
    });
    const eligible = regs.filter(r => r.class_id === batch.class_id && r.handoff_status === 'SubmittedToInstitution');
    this.setData({ eligible, selectedToAdd: [] });
  },

  onSelectAdd(e) {
    this.setData({ selectedToAdd: e.detail.value });
  },

  onSelectRemove(e) {
    this.setData({ selectedToRemove: e.detail.value });
  },

  async onAdd() {
    const { selectedToAdd, id } = this.data;
    if (!selectedToAdd.length) {
      wx.showToast({ title: '请选择要加入的报名', icon: 'none' });
      return;
    }
    try {
      await api.instBatchAddItems(id, selectedToAdd);
      wx.showToast({ title: '已加入', icon: 'success' });
      await this.load();
    } catch (e) {
      console.error(e);
      wx.showToast({ title: e.message || '加入失败', icon: 'none' });
    }
  },

  async onRemove() {
    const { selectedToRemove, id } = this.data;
    if (!selectedToRemove.length) {
      wx.showToast({ title: '请选择要移除的条目', icon: 'none' });
      return;
    }
    try {
      await api.instBatchRemoveItems(id, selectedToRemove);
      wx.showToast({ title: '已移除', icon: 'success' });
      await this.load();
    } catch (e) {
      console.error(e);
      wx.showToast({ title: e.message || '移除失败', icon: 'none' });
    }
  },

  async onPreflight() {
    try {
      const preflight = await api.instBatchPreflight(this.data.id);
      this.setData({ preflight });
    } catch (e) {
      wx.showToast({ title: e.message || '校验失败', icon: 'none' });
    }
  },

  async onSubmitToSuper() {
    try {
      await api.instBatchSubmitToSuper(this.data.id);
      wx.showToast({ title: '已提交考区', icon: 'success' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    }
  },
});
