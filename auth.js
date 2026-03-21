/**
 * Google Sign-In Authentication Module (Optional Login)
 * Users can use the app without logging in (localStorage only).
 * Signing in with Google scopes data to the user's account.
 */
var Auth = (function() {
  var CLIENT_ID = localStorage.getItem('google_client_id') || '';
  var _user = null;
  var _onLoginCb = null;
  var _onLogoutCb = null;

  function _storageKey(k) {
    if (_user && _user.sub) return 'u_' + _user.sub + '_' + k;
    return k;
  }

  function _decodeJWT(token) {
    try {
      var parts = token.split('.');
      if (parts.length !== 3) return null;
      var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      var decoded = atob(payload);
      return JSON.parse(decoded);
    } catch(e) {
      return null;
    }
  }

  function _handleCredentialResponse(response) {
    if (!response || !response.credential) return;
    var payload = _decodeJWT(response.credential);
    if (!payload) return;
    _user = {
      sub: payload.sub,
      name: payload.name || '',
      email: payload.email || '',
      picture: payload.picture || ''
    };
    localStorage.setItem('gsi_credential', response.credential);
    // Migrate plain keys to user-scoped keys on first login
    _migrateKeys();
    if (_onLoginCb) _onLoginCb(_user);
  }

  function _migrateKeys() {
    var keys = ['finnhub_key', 'groq_key', 'av_key', 'tracked_stocks', 'price_alerts',
                'report_email', 'tile_order', 'tile_collapsed', 'tile_visibility'];
    keys.forEach(function(k) {
      var scoped = _storageKey(k);
      if (scoped !== k && !localStorage.getItem(scoped)) {
        var val = localStorage.getItem(k);
        if (val) localStorage.setItem(scoped, val);
      }
    });
  }

  return {
    getItem: function(k) { return localStorage.getItem(_storageKey(k)); },
    setItem: function(k, v) { localStorage.setItem(_storageKey(k), v); },
    removeItem: function(k) { localStorage.removeItem(_storageKey(k)); },

    isLoggedIn: function() { return !!_user; },
    getUser: function() { return _user; },

    onLogin: function(cb) { _onLoginCb = cb; },
    onLogout: function(cb) { _onLogoutCb = cb; },

    getClientId: function() { return CLIENT_ID; },
    setClientId: function(id) {
      CLIENT_ID = id;
      localStorage.setItem('google_client_id', id);
    },

    initGSI: function() {
      if (!CLIENT_ID) return false;
      if (!window.google || !google.accounts || !google.accounts.id) return false;
      try {
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: _handleCredentialResponse,
          auto_select: true,
          cancel_on_tap_outside: false
        });
        return true;
      } catch(e) {
        console.warn('GSI init error:', e);
        return false;
      }
    },

    renderButton: function(elementId) {
      if (!CLIENT_ID) return;
      if (!window.google || !google.accounts || !google.accounts.id) return;
      var el = document.getElementById(elementId);
      if (!el) return;
      try {
        google.accounts.id.renderButton(el, {
          theme: 'filled_black',
          size: 'large',
          width: 240,
          text: 'signin_with'
        });
      } catch(e) {
        console.warn('GSI render error:', e);
      }
    },

    prompt: function() {
      if (!CLIENT_ID) return;
      if (!window.google || !google.accounts || !google.accounts.id) return;
      try { google.accounts.id.prompt(); } catch(e) {}
    },

    restoreSession: function() {
      var cred = localStorage.getItem('gsi_credential');
      if (!cred) return false;
      var payload = _decodeJWT(cred);
      if (!payload) {
        localStorage.removeItem('gsi_credential');
        return false;
      }
      // Check expiry
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        localStorage.removeItem('gsi_credential');
        return false;
      }
      _user = {
        sub: payload.sub,
        name: payload.name || '',
        email: payload.email || '',
        picture: payload.picture || ''
      };
      return true;
    },

    logout: function() {
      _user = null;
      localStorage.removeItem('gsi_credential');
      if (window.google && google.accounts && google.accounts.id) {
        try { google.accounts.id.disableAutoSelect(); } catch(e) {}
      }
      if (_onLogoutCb) _onLogoutCb();
    }
  };
})();
