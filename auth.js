/**
 * Google Sign-In Authentication Module
 * Uses Google Identity Services (GSI) for client-side auth.
 * Each user gets isolated localStorage keyed by their Google ID.
 *
 * Setup: Create a Google Cloud project, enable OAuth, create a Web Client ID.
 * https://console.cloud.google.com/apis/credentials
 * Add your GitHub Pages URL to Authorized JavaScript Origins.
 */
var Auth = (function() {
  // Replace with your own Google OAuth Client ID
  var CLIENT_ID = '';

  var currentUser = null;
  var onLoginCb = null;
  var onLogoutCb = null;

  function getClientId() {
    return localStorage.getItem('google_client_id') || CLIENT_ID;
  }

  function setClientId(id) {
    localStorage.setItem('google_client_id', id.trim());
  }

  /** Returns the storage key prefix for the current user, e.g. "u_123456_" */
  function prefix() {
    if (!currentUser) return '';
    return 'u_' + currentUser.id + '_';
  }

  /** User-scoped localStorage get */
  function getItem(key) {
    return localStorage.getItem(prefix() + key);
  }

  /** User-scoped localStorage set */
  function setItem(key, value) {
    localStorage.setItem(prefix() + key, value);
  }

  /** User-scoped localStorage remove */
  function removeItem(key) {
    localStorage.removeItem(prefix() + key);
  }

  function isLoggedIn() {
    return currentUser !== null;
  }

  function getUser() {
    return currentUser;
  }

  function onLogin(cb) { onLoginCb = cb; }
  function onLogout(cb) { onLogoutCb = cb; }

  /** Decode a JWT token payload (Google credential is a JWT) */
  function decodeJwt(token) {
    try {
      var parts = token.split('.');
      if (parts.length !== 3) return null;
      var payload = parts[1];
      // Base64url decode
      payload = payload.replace(/-/g, '+').replace(/_/g, '/');
      var pad = payload.length % 4;
      if (pad) payload += new Array(5 - pad).join('=');
      var decoded = atob(payload);
      return JSON.parse(decoded);
    } catch (e) {
      console.warn('JWT decode error:', e.message);
      return null;
    }
  }

  /** Handle the Google credential response */
  function handleCredentialResponse(response) {
    if (!response || !response.credential) return;
    var payload = decodeJwt(response.credential);
    if (!payload || !payload.sub) return;

    currentUser = {
      id: payload.sub,
      email: payload.email || '',
      name: payload.name || '',
      picture: payload.picture || '',
      token: response.credential,
    };

    // Persist session
    localStorage.setItem('auth_session', JSON.stringify({
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
      picture: currentUser.picture,
    }));

    if (onLoginCb) onLoginCb(currentUser);
  }

  /** Try to restore session from localStorage */
  function restoreSession() {
    try {
      var saved = localStorage.getItem('auth_session');
      if (!saved) return false;
      var data = JSON.parse(saved);
      if (!data || !data.id) return false;
      currentUser = {
        id: data.id,
        email: data.email || '',
        name: data.name || '',
        picture: data.picture || '',
        token: null,
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  function logout() {
    currentUser = null;
    localStorage.removeItem('auth_session');
    // Revoke Google session
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
    if (onLogoutCb) onLogoutCb();
  }

  /** Initialize Google Identity Services */
  function initGSI() {
    var clientId = getClientId();
    if (!clientId) return;
    if (!window.google || !google.accounts || !google.accounts.id) {
      console.warn('Google Identity Services not loaded.');
      return;
    }
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      auto_select: true,
      cancel_on_tap_outside: false,
    });
  }

  /** Render the Google Sign-In button into a container element */
  function renderButton(containerId) {
    var clientId = getClientId();
    if (!clientId) return;
    if (!window.google || !google.accounts || !google.accounts.id) return;
    var el = document.getElementById(containerId);
    if (!el) return;
    google.accounts.id.renderButton(el, {
      theme: 'filled_black',
      size: 'large',
      shape: 'rectangular',
      text: 'signin_with',
      width: 280,
    });
  }

  /** Show the One Tap prompt */
  function prompt() {
    var clientId = getClientId();
    if (!clientId) return;
    if (!window.google || !google.accounts || !google.accounts.id) return;
    google.accounts.id.prompt();
  }

  return {
    getClientId: getClientId,
    setClientId: setClientId,
    prefix: prefix,
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    isLoggedIn: isLoggedIn,
    getUser: getUser,
    onLogin: onLogin,
    onLogout: onLogout,
    restoreSession: restoreSession,
    logout: logout,
    initGSI: initGSI,
    renderButton: renderButton,
    prompt: prompt,
  };
})();
