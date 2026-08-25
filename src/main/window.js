const path = require('path');
const { BrowserWindow, shell, session } = require('electron');
const { USER_AGENT } = require('./user-agent');

const HOME_URL = 'https://soundcloud.com/discover';

const PROVIDER_HOSTS = [
  /(^|\.)google\.com$/i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)apple\.com$/i
];

const AUTH_HOSTS = [/(^|\.)soundcloud\.com$/i, ...PROVIDER_HOSTS];

const AUTH_COOKIE_NAMES = [
  'oauth_token',
  '_soundcloud_session',
  'google_auth_nonce',
  'sc_anonymous_id'
];

const MAX_LOGOUT_RECOVERIES = 3;

function isLogoutUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return /(^|\.)soundcloud\.com$/i.test(hostname) && pathname === '/logout';
  } catch {
    return false;
  }
}

async function clearAuthCookies() {
  const ses = session.defaultSession;
  let cookies;
  try {
    cookies = await ses.cookies.get({ domain: 'soundcloud.com' });
  } catch {
    return;
  }
  for (const cookie of cookies) {
    if (!AUTH_COOKIE_NAMES.includes(cookie.name)) continue;
    const host = cookie.domain.replace(/^\./, '');
    try {
      await ses.cookies.remove(`https://${host}${cookie.path || '/'}`, cookie.name);
    } catch {
    }
  }
}

function isInternal(url) {
  return /^https:\/\/([a-z0-9-]+\.)*soundcloud\.com(\/|$)/i.test(url);
}

function isBlank(url) {
  return !url || url === 'about:blank' || url === 'about:blank#blocked';
}

function matchesHost(url, hosts) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return hosts.some((host) => host.test(hostname));
  } catch {
    return false;
  }
}

const isAuthUrl = (url) => matchesHost(url, AUTH_HOSTS);
const isProviderUrl = (url) => matchesHost(url, PROVIDER_HOSTS);

function createWindow(store, { onProviderSignIn } = {}) {
  const bounds = store.get('windowBounds', { width: 1280, height: 800 });

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    title: 'SoundCloud',
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../build/icons/256x256.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/player-bridge.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  if (store.get('maximized', false)) win.maximize();

  win.loadURL(HOME_URL, { userAgent: USER_AGENT });
  win.once('ready-to-show', () => win.show());

  const persistBounds = () => {
    if (win.isDestroyed()) return;
    store.set('maximized', win.isMaximized());
    if (!win.isMaximized() && !win.isFullScreen()) {
      store.set('windowBounds', win.getNormalBounds());
    }
  };
  win.on('resize', debounce(persistBounds, 400));
  win.on('move', debounce(persistBounds, 400));
  win.on('close', persistBounds);

  let logoutRecoveries = 0;
  win.webContents.on('did-navigate', (_event, url) => {
    if (!isLogoutUrl(url)) {
      if (isInternal(url)) logoutRecoveries = 0;
      return;
    }
    if (logoutRecoveries >= MAX_LOGOUT_RECOVERIES) return;
    logoutRecoveries += 1;
    clearAuthCookies().then(() => {
      if (!win.isDestroyed()) win.loadURL(HOME_URL, { userAgent: USER_AGENT });
    });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isProviderUrl(url)) {
      if (onProviderSignIn) onProviderSignIn();
      return { action: 'deny' };
    }
    if (isAuthUrl(url) || isBlank(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: win,
          modal: false,
          width: 520,
          height: 700,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        }
      };
    }
    if (isInternal(url)) {
      win.loadURL(url, { userAgent: USER_AGENT });
    } else if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('did-create-window', (child) => {
    child.setMenu(null);

    child.webContents.setWindowOpenHandler(({ url }) => {
      if (isProviderUrl(url)) {
        if (onProviderSignIn) onProviderSignIn();
        return { action: 'deny' };
      }
      if (isAuthUrl(url) || isInternal(url) || isBlank(url)) return { action: 'allow' };
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    child.webContents.on('will-navigate', (event, url) => {
      if (isProviderUrl(url)) {
        event.preventDefault();
        if (!child.isDestroyed()) child.close();
        if (onProviderSignIn) onProviderSignIn();
        return;
      }
      if (!isAuthUrl(url) && !isInternal(url) && !isBlank(url) && /^https?:/i.test(url)) {
        event.preventDefault();
        shell.openExternal(url);
        if (!child.isDestroyed()) child.close();
      }
    });
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url) && !isAuthUrl(url) && /^https?:/i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

module.exports = { createWindow, HOME_URL, USER_AGENT };
