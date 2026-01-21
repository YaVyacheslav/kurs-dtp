export class ApiClient {
  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl;
  }

  getToken() {
    return localStorage.getItem("access_token");
  }

  setToken(token) {
    localStorage.setItem("access_token", token);
  }

  removeToken() {
    localStorage.removeItem("access_token");
  }

  resolveUrl(endpoint) {
    if (/^https?:\/\//i.test(endpoint)) return endpoint;
    if (endpoint.startsWith('/')) return endpoint;

    endpoint = endpoint.replace(/^api\//, '');

    return `${this.baseUrl}/${endpoint}`;
  }

  async request(endpoint, options = {}) {
    const url = this.resolveUrl(endpoint);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const config = { ...options, headers };

    const response = await fetch(url, config);

    if (!response.ok) {
      const raw = await response.text();
      let msg = raw || `Error ${response.status}`;

      try {
        const j = JSON.parse(raw);
        if (j?.error) msg = j.error;
      } catch (_) {}

      const isAuthLoginOrRegister =
        url.includes('/auth.php?action=login') || url.includes('/auth.php?action=register');

      if (response.status === 401) {
        if (!isAuthLoginOrRegister) {
          this.removeToken();

          const onAuthPage =
            window.location.pathname.includes('login') ||
            window.location.pathname.includes('register');

          if (!onAuthPage) window.location.href = "login.html";
        }
      }

      throw new Error(msg);
    }

    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  get(url) {
    return this.request(url, { method: 'GET' });
  }

  post(url, body) {
    return this.request(url, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  getClusters(params = {}) {
    const sp = new URLSearchParams(params);
    const qs = sp.toString();
    return this.get(`clusters.php${qs ? `?${qs}` : ''}`);
  }

  login(email, password) {
    return this.post('auth.php?action=login', { email, password });
  }

  register(email, password) {
    return this.post('auth.php?action=register', { email, password });
  }

  getMe() {
    return this.get('auth.php?action=me');
  }

  getClusterEvents(clusterId, limit = 2000, offset = 0) {
    return this.get(`events.php?cluster_id=${encodeURIComponent(clusterId)}&limit=${limit}&offset=${offset}`);
  }

  runAnalyze(params = {}) {
    return this.post('run_analyze.php', params);
  }
}

export const api = new ApiClient();
