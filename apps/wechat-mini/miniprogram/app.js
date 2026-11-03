import { authLogin, parentSession } from './utils/api';

App({
  globalData: {
    userInfo: null,
    session: null,
    loginReady: false,
    loginPromise: null,
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'kaoji-assist-5gimm9yh10270edc',
        traceUser: true,
      });
    }

    // Store login promise for pages to await
    this.globalData.loginPromise = this.login();
  },

  async login() {
    try {
      const loginResult = await wx.login();
      if (!loginResult.code) throw new Error('wx.login did not return a code');
      const auth = await authLogin(loginResult.code);
      wx.setStorageSync('MEA_PARENT_SESSION', auth.parent_token);
      const access = await parentSession();
      this.globalData.session = {...auth, ...access};
      return this.globalData.session;
    } catch (err) {
      wx.removeStorageSync('MEA_PARENT_SESSION');
      this.globalData.session = null;
      console.error('Parent login failed:', err?.message || 'Unknown error');
      return null;
    } finally {
      this.globalData.loginReady = true;
    }
  },

  // Pages should call this to ensure login is complete
  async ensureLogin() {
    const session = this.globalData.session;
    if (session && session.expires_at && Date.parse(session.expires_at) <= Date.now()) {
      this.globalData.session = null;
      this.globalData.loginReady = false;
      this.globalData.loginPromise = this.login();
    }
    if (this.globalData.loginReady) {
      return this.globalData.session;
    }
    if (this.globalData.loginPromise) {
      return await this.globalData.loginPromise;
    }
    this.globalData.loginPromise = this.login();
    return await this.globalData.loginPromise;
  },

  getSession() {
    return this.globalData.session;
  },

  hasRole(role) {
    const s = this.globalData.session;
    if (!s) return false;
    if (role === 'Parent') return s.role === 'parent';
    return false;
  }
});
