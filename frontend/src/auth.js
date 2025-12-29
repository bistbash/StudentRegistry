import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

// Get API URL - use environment variable or construct from current origin
const getApiUrl = () => {
  // In browser, always use the same origin/hostname as the frontend
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    // If accessing via localhost/127.0.0.1, use localhost:3001
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return 'http://localhost:3001';
    }
    // Otherwise use the same hostname with port 3001
    return origin.replace(/:3000$/, ':3001');
  }
  // Fallback to env var or default
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || '';
const AUTHENTIK_ISSUER = import.meta.env.VITE_AUTHENTIK_ISSUER || '';
const CLIENT_ID = import.meta.env.VITE_AUTHENTIK_CLIENT_ID || '';
// Always use current origin for redirect URI (local dev vs server)
const REDIRECT_URI = typeof window !== 'undefined' ? window.location.origin : (import.meta.env.VITE_AUTHENTIK_REDIRECT_URI || '');
const API_URL = getApiUrl();

const issuerBase = AUTHENTIK_ISSUER ? AUTHENTIK_ISSUER.replace(/\/$/, '') : '';

const config = CLIENT_ID && issuerBase && REDIRECT_URI ? {
  authority: issuerBase,
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  post_logout_redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  loadUserInfo: true,
  // For public clients, ensure no client_secret is sent
  // PKCE is enabled by default in oidc-client-ts for browser clients
  automaticSilentRenew: false,
  // Ensure client_secret is not included (for public clients)
  extraTokenParams: {},
} : null;

let userManager = null;

export const initAuth = () => {
  if (config && CLIENT_ID) {
    userManager = new UserManager(config);
  }
  return userManager;
};

export const getUserManager = () => {
  if (!userManager && config && CLIENT_ID) {
    try {
      userManager = new UserManager(config);
    } catch (error) {
      console.error('Error initializing UserManager:', error);
      return null;
    }
  }
  return userManager;
};

export const login = async () => {
  const manager = getUserManager();
  if (manager) {
    await manager.signinRedirect();
  }
};

export const logout = async () => {
  const manager = getUserManager();
  if (manager) {
    await manager.signoutRedirect();
  }
};

export const getUser = async () => {
  try {
    const manager = getUserManager();
    if (!manager) {
      return null;
    }
    
    // Add timeout to prevent hanging
    const getUserPromise = manager.getUser();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('getUser timeout')), 2000)
    );
    
    const user = await Promise.race([getUserPromise, timeoutPromise]);
    return user;
  } catch (error) {
    // Silently fail - user just needs to login
    return null;
  }
};

export const handleCallback = async () => {
  try {
    const manager = getUserManager();
    if (manager) {
      const user = await manager.signinRedirectCallback();
      return user;
    }
    return null;
  } catch (error) {
    console.error('Error handling callback:', error);
    return null;
  }
};

export const getAccessToken = async () => {
  try {
    const user = await getUser();
    return user?.access_token || null;
  } catch (error) {
    console.error('Error getting access token:', error);
    return null;
  }
};

export const isAuthenticated = async () => {
  try {
    const user = await getUser();
    return !!user && !user.expired;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
};

export const getAuthConfig = async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${API_URL}/api/auth/config`, {
      signal: controller.signal,
      cache: 'no-cache'
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Auth config request timed out');
    } else {
      console.error('Error fetching auth config:', error);
    }
    return { enabled: false };
  }
};

