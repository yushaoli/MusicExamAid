import api from '../../../utils/api';
Page({
  data: { registrations: [], loading: true, filters: { cycle_id: '', status: [] } },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true });
    try {
      const registrations = await api.teacherRosterList(this.data.filters);
      this.setData({ registrations, loading: false });
    } catch (e) { this.setData({ loading: false }); }
  },
  goToReview(e) { wx.navigateTo({ url: `/pages/teacher/review/review?id=${e.currentTarget.dataset.id}` }); },
});

