const app = getApp();
import api from '../../../utils/api';

Page({
  data: {
    id: null,
    ready: false,
    loadFailed: false,
    form: {
      name_cn: '', name_en_optional: '', gender: '男', dob: '',
      nationality: '中国', ethnicity_optional: '', id_type: '身份证', id_number: '',
      guardian_phone: '', mailing_address_optional: '', recipient_name_optional: '', recipient_phone_optional: ''
    },
    genderOptions: ['男', '女'],
  },

  async onLoad(options) {
    await app.ensureLogin(); // Wait for login first
    if (options.id) {
      this.setData({ id: options.id });
      this.loadLearner(options.id);
    }
  },

  async loadLearner(id) {
    try {
      const data = await api.learnerGet(id);
      this.setData({ form: { ...this.data.form, ...data, id_number: '' }, ready: true });
    } catch (e) {
      console.error('Load learner failed:', e);
      this.setData({ loadFailed: true });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onPickerChange(e) {
    const field = e.currentTarget.dataset.field;
    const options = e.currentTarget.dataset.options;
    this.setData({ [`form.${field}`]: this.data[options][e.detail.value] });
  },

  onDateChange(e) {
    this.setData({ 'form.dob': e.detail.value });
  },

  async onSubmit() {
    const { id, form, ready } = this.data;
    if (!id || !ready) return;
    if (!form.name_cn || !form.guardian_phone) {
      wx.showToast({ title: '请填写必填项', icon: 'none' });
      return;
    }
    try {
      await api.learnerUpsert({ learner_id: id, ...form });
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1000);
    } catch (e) {
      console.error('Save failed:', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
