/**
 * SAFE Period Tracker - Manager Service
 * Connects frontend UI components to backend REST APIs
 */

const API_BASE = 'http://localhost:3000';

class ManagerService {
  constructor() {
    this.tokenKey = 'safe_token';
    this.userKey = 'safe_user';
  }

  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  setToken(token) {
    localStorage.setItem(this.tokenKey, token);
  }

  getUser() {
    const raw = localStorage.getItem(this.userKey);
    return raw ? JSON.parse(raw) : null;
  }

  setUser(user) {
    localStorage.setItem(this.userKey, JSON.stringify(user));
  }

  clearAuth() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  }

  getHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  // Auth Operations
  async login(identifier, password) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const data = await res.json();
    if (data.success) {
      this.setToken(data.token);
      this.setUser(data.user);
    }
    return data;
  }

  async register(userData) {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    const data = await res.json();
    if (data.success) {
      this.setToken(data.token);
      this.setUser(data.user);
    }
    return data;
  }

  async getCurrentUser() {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: this.getHeaders()
    });
    return res.json();
  }

  async updateProfile(profileData) {
    const res = await fetch(`${API_BASE}/api/my/profile`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(profileData)
    });
    const data = await res.json();
    if (data.success && data.user) {
      this.setUser(data.user);
    }
    return data;
  }

  // Period Tracking Lifecycle Operations
  async getCycles() {
    const res = await fetch(`${API_BASE}/api/my/cycles`, {
      headers: this.getHeaders()
    });
    return res.json();
  }

  async logCycle(cyclePayload) {
    const res = await fetch(`${API_BASE}/api/my/cycles`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(cyclePayload)
    });
    return res.json();
  }

  async deleteCycle(cycleId) {
    const res = await fetch(`${API_BASE}/api/my/cycles/${cycleId}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    return res.json();
  }

  // Analytics & Forecasts
  async getAnalytics() {
    const res = await fetch(`${API_BASE}/api/my/analytics`, {
      headers: this.getHeaders()
    });
    return res.json();
  }

  // Smart Pre-Period & Ovulation Notifications
  async getNotifications() {
    const res = await fetch(`${API_BASE}/api/my/notifications`, {
      headers: this.getHeaders()
    });
    return res.json();
  }

  // Empathetic AI Copilot Chat
  async sendChatMessage(message, lang = 'en') {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ message, lang })
    });
    return res.json();
  }
}

export const managerService = new ManagerService();
if (typeof window !== 'undefined') {
  window.managerService = managerService;
}
export default managerService;
