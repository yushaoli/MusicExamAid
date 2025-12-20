App({
  globalData: {
    userInfo: null,
    session: null,
    loginReady: false,
    loginPromise: null,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      env: 'kaoji-assist-5gimm9yh10270edc',
      traceUser: true,
    });
    
    // Store login promise for pages to await
    this.globalData.loginPromise = this.login();
  },

  async login() {
    try {
      console.log('Starting login...');
      const res = await wx.cloud.callFunction({ name: 'authLogin' });
      console.log('Login response:', res);
      
      if (res.result && res.result.success) {
        this.globalData.session = res.result.data;
        this.globalData.loginReady = true;
        console.log('Login success:', this.globalData.session);
        return this.globalData.session;
      } else {
        console.error('Login failed:', res.result?.error);
        this.globalData.loginReady = true;
        return null;
      }
    } catch (err) {
      console.error('Login error:', err);
      this.globalData.loginReady = true;
      return null;
    }
  },

  // Pages should call this to ensure login is complete
  async ensureLogin() {
    if (this.globalData.loginReady) {
      return this.globalData.session;
    }
    if (this.globalData.loginPromise) {
      return await this.globalData.loginPromise;
    }
    return null;
  },

  getSession() {
    return this.globalData.session;
  },

  hasRole(role) {
    const s = this.globalData.session;
    if (!s) return false;
    if (role === 'Teacher') return s.isTeacher;
    if (role === 'Admin') return s.isAdmin;
    if (role === 'Super') return s.isSuper;
    return false;
  }
});
