/**
 * ATP API Client
 * Shared across all pages. Handles auth, token storage,
 * and all calls to the backend API.
 *
 * Usage: include this script before any page-specific JS.
 * <script src="atp-api.js"></script>
 */

(function(window) {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────
  // Switch to your Railway URL when backend is live:
  // const API_BASE = 'https://atp-backend.railway.app/api';
  const API_BASE = window.ATP_API_BASE || 'https://atp-backend-production.up.railway.app/api';
  const TOKEN_KEY = 'atp:jwt';
  const USER_KEY  = 'atp:user';

  // ── TOKEN MANAGEMENT ────────────────────────────────────────
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch(e) { return null; }
  }
  function setUser(member) {
    localStorage.setItem(USER_KEY, JSON.stringify(member));
  }

  // ── CORE FETCH ───────────────────────────────────────────────
  async function request(method, path, body, opts) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    });

    // Token expired — clear and redirect to login
    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      if (data.code === 'TOKEN_EXPIRED') {
        clearToken();
        window.location.href = '/index.html';
        return;
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, data: err });
    }

    // 204 No Content
    if (res.status === 204) return null;
    return res.json();
  }

  const get    = (path)        => request('GET',    path);
  const post   = (path, body)  => request('POST',   path, body);
  const patch  = (path, body)  => request('PATCH',  path, body);
  const put    = (path, body)  => request('PUT',    path, body);
  const del    = (path)        => request('DELETE', path);

  // ── AUTH ─────────────────────────────────────────────────────
  const auth = {
    async register(firstName, lastName, email, phone) {
      const data = await post('/auth/register', { first_name: firstName, last_name: lastName, email, phone });
      setToken(data.token);
      setUser(data.member);
      return data.member;
    },

    async login(email, password) {
      const data = await post('/auth/login', { email, password });
      setToken(data.token);
      setUser(data.member);
      return data.member;
    },

    async requestMagicLink(email) {
      return post('/auth/magic-link', { email });
    },

    async verifyMagicLink(token, email) {
      const data = await get(`/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`);
      setToken(data.token);
      // Fetch full member profile
      const me = await auth.me();
      return { member: me, isFirstLogin: data.isFirstLogin };
    },

    async googleLogin(idToken) {
      const data = await post('/auth/google', { id_token: idToken });
      setToken(data.token);
      setUser(data.member);
      return data.member;
    },

    async me() {
      const data = await get('/auth/me');
      setUser(data.member);
      return data.member;
    },

    async logout() {
      try { await post('/auth/logout'); } catch(e) {}
      clearToken();
    },

    async changePassword(currentPassword, newPassword) {
      return post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
    },

    isLoggedIn() { return !!getToken(); },
    getUser,
    getToken,
  };

  // ── MEMBERS ──────────────────────────────────────────────────
  const members = {
    getProfile:    ()     => get('/members/profile'),
    getStats:      ()     => get('/members/stats'),
    getBookings:   ()     => get('/members/bookings'),
    getPointsHistory: (page) => get(`/members/points-history?page=${page||1}`),
    getReferrals:  ()     => get('/members/referrals'),
    getFriends:    ()     => get('/members/friends'),
    getLeaderboard:(period, cityId) => get(`/members/leaderboard?period=${period||'mtd'}${cityId?'&city_id='+cityId:''}`),

    updateProfile: (data) => patch('/members/profile', data),
    updateAvatar:  (url)  => patch('/members/avatar', { avatar_url: url }),

    sendFriendRequest: (targetId)     => post('/members/friends/request', { target_id: targetId }),
    respondToFriend:   (id, status)   => patch(`/members/friends/${id}`, { status }),
  };

  // ── SESSIONS ─────────────────────────────────────────────────
  const sessions = {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return get('/sessions' + (qs ? '?' + qs : ''));
    },
    get:           (id)    => get(`/sessions/${id}`),
    create:        (data)  => post('/sessions', data),
    complete:      (id)    => patch(`/sessions/${id}/complete`),
    getAttendance: (id)    => get(`/sessions/${id}/attendance`),
    checkin:       (id, data) => post(`/sessions/${id}/checkin`, data),
  };

  // ── BOOKINGS ─────────────────────────────────────────────────
  const bookings = {
    book:          (sessionId) => post('/bookings', { session_id: sessionId }),
    cancel:        (id)        => del(`/bookings/${id}`),
    getQRData:     (token)     => get(`/bookings/${token}/qr-data`),
    submitFeedback:(id, rating, comment) => post(`/bookings/${id}/feedback`, { rating, comment }),
  };

  // ── POINTS ───────────────────────────────────────────────────
  const points = {
    getBalance:  ()           => get('/points/balance'),
    getConfig:   ()           => get('/points/config'),
    redeem:      (amount)     => post('/points/redeem', { points_to_redeem: amount }),
    adminAdjust: (memberId, amount, reason, description) =>
      post('/points/admin-adjust', { member_id: memberId, amount, reason, description }),
  };

  // ── COMMUNITY ─────────────────────────────────────────────────
  const community = {
    getFeed:      (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return get('/community/feed' + (qs ? '?' + qs : ''));
    },
    createPost:   (content, media)  => post('/community/posts', { content, media }),
    deletePost:   (id)              => del(`/community/posts/${id}`),
    likePost:     (id)              => post(`/community/posts/${id}/like`),
    getComments:  (id)              => get(`/community/posts/${id}/comments`),
    addComment:   (id, content, parentId) => post(`/community/posts/${id}/comments`, { content, parent_id: parentId }),
    reportPost:   (id, reason, desc) => post(`/community/posts/${id}/report`, { reason, description: desc }),

    getConversations: ()            => get('/community/messages'),
    getMessages:  (memberId)        => get(`/community/messages/${memberId}`),
    sendMessage:  (memberId, content) => post(`/community/messages/${memberId}`, { content }),
  };

  // ── CHALLENGES ───────────────────────────────────────────────
  const challenges = {
    list:           (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return get('/challenges' + (qs ? '?' + qs : ''));
    },
    create:         (data)        => post('/challenges', data),
    join:           (id)          => post(`/challenges/${id}/join`),
    updateProgress: (id, progress) => patch(`/challenges/${id}/progress`, { progress }),
    end:            (id)          => del(`/challenges/${id}`),
  };

  // ── NOTIFICATIONS ─────────────────────────────────────────────
  const notifications = {
    list:        (unreadOnly) => get(`/notifications${unreadOnly?'?unread_only=true':''}`),
    markRead:    (id)         => patch(`/notifications/${id}/read`),
    markAllRead: ()           => patch('/notifications/read-all'),
    registerPushToken: (token, platform) => post('/notifications/push-token', { token, platform }),
    broadcast:   (data)       => post('/notifications/broadcast', data),
  };

  // ── ADMIN ─────────────────────────────────────────────────────
  const admin = {
    getDashboard:    ()       => get('/admin/dashboard'),
    getAnalytics:    (period) => get(`/admin/analytics?period=${period||'6months'}`),
    getMembers:      (params) => {
      const qs = new URLSearchParams(params||{}).toString();
      return get('/admin/members' + (qs ? '?' + qs : ''));
    },
    setAmbassador:   (id, enabled)      => patch(`/admin/members/${id}/ambassador`, { enabled }),
    setBan:          (id, banned, reason) => patch(`/admin/members/${id}/ban`, { banned, reason }),
    getReports:      ()                 => get('/admin/reports'),
    resolveReport:   (id)               => patch(`/admin/reports/${id}/resolve`),
    importMembers:   (members)          => post('/admin/members/import', { members }),
  };

  // ── CMS ──────────────────────────────────────────────────────
  const cms = {
    getPage:    (page)              => get(`/cms/${page}`),
    getSection: (page, section)     => get(`/cms/${page}/${section}`),
    update:     (page, section, key, values) => put(`/cms/${page}/${section}/${key}`, values),
  };

  // ── INIT: restore session on page load ───────────────────────
  async function init() {
    const token = getToken();
    if (!token) return null;

    try {
      const member = await auth.me();
      return member;
    } catch(e) {
      // Token invalid or expired
      clearToken();
      return null;
    }
  }

  // ── EXPOSE ───────────────────────────────────────────────────
  window.ATP = {
    auth, members, sessions, bookings, points,
    community, challenges, notifications, admin, cms,
    init,
    getUser, getToken, isLoggedIn: auth.isLoggedIn,
    API_BASE,
  };

})(window);
