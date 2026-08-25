const path = require('path');
const {
  app,
  dialog,
  ipcMain,
  session,
  Menu,
  Notification,
  globalShortcut,
  nativeImage,
  net,
  shell
} = require('electron');

const { Store } = require('./store');
const { createWindow, HOME_URL } = require('./window');
const { USER_AGENT, applyChromeIdentity } = require('./user-agent');
const { applyAdblock } = require('./adblock');
const { setupMpris } = require('./mpris');
const { createTray } = require('./tray');
const { findBestStore, importInto, importFromFile } = require('./cookie-import');
const { signInViaBrowser, applyCookies } = require('./browser-login');
const { DiscordPresence } = require('./discord-presence');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

app.setName('SoundCloud');
app.setDesktopName('soundcloud.desktop');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null;
let tray = null;
let mpris = null;
let store = null;
let lastState = { hasTrack: false, playing: false, title: null, artist: null };
let quitting = false;
let adblock = null;
let discord = null;
let discordKey = '';
let discordStart = 0;

const DEFAULT_DISCORD_CLIENT_ID = '1090770350251458592';
const INSTALL_URL = 'https://github.com/xBibouu/SoundcloudApp-LinuxWindows/releases/latest';

function discordClientId() {
  return (
    process.env.SC_DISCORD_CLIENT_ID ||
    (store && store.get('discordClientId', '')) ||
    DEFAULT_DISCORD_CLIENT_ID
  );
}

function setupDiscord() {
  const id = discordClientId();
  if (discord) discord.disconnect();
  discord = new DiscordPresence(id);
  discordKey = '';
  if (id && store.get('discordPresence', true)) discord.connect();
}

const DISCORD_BUTTON_LABEL = "Installer l'App".slice(0, 32);

function clamp(text, fallback) {
  const value = (text || '').trim() || fallback;
  if (value.length < 2) return `${value} `;
  return value.length > 128 ? `${value.slice(0, 127)}…` : value;
}

function updateDiscord(state) {
  if (!discord || !discordClientId() || !store.get('discordPresence', true)) return;

  if (!state.hasTrack) {
    if (discordKey !== 'idle') {
      discordKey = 'idle';
      discordStart = 0;
      discord.clear();
    }
    return;
  }

  const duration = Math.round(state.duration || 0);
  const start =
    state.playing && duration > 1
      ? Date.now() - Math.floor((state.position || 0) * 1000)
      : 0;

  const drifted = start && discordStart && Math.abs(start - discordStart) > 2500;

  const key = `${state.title}|${state.artist}|${state.playing}|${duration}`;
  if (key === discordKey && !drifted) return;
  discordKey = key;
  discordStart = start;

  const activity = {
    type: 2,
    details: clamp(state.title, 'SoundCloud'),
    state: clamp(state.artist, 'SoundCloud'),
    largeImageKey: state.artwork || 'idle',
    largeImageText: 'SoundCloud',
    instance: false,
    buttons: [{ label: DISCORD_BUTTON_LABEL, url: INSTALL_URL }]
  };

  if (start) {
    activity.startTimestamp = start;
    activity.endTimestamp = start + duration * 1000;
  }

  discord.update(activity);
}

function send(command) {
  if (win && !win.isDestroyed()) win.webContents.send('player:command', command);
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

async function notifyTrack(state) {
  if (!Notification.isSupported()) return;
  if (!store.get('notifications', true)) return;
  if (!state.hasTrack || !state.playing) return;

  const notification = {
    title: state.title || 'SoundCloud',
    body: state.artist || 'SoundCloud',
    silent: true,
    urgency: 'low'
  };

  if (state.artwork) {
    try {
      const response = await net.fetch(state.artwork);
      if (response.ok) {
        const image = nativeImage.createFromBuffer(
          Buffer.from(await response.arrayBuffer())
        );
        if (!image.isEmpty()) notification.icon = image;
      }
    } catch {
    }
  }

  new Notification(notification).show();
}

async function importSession({ quiet = false } = {}) {
  let best;
  let stores;
  let errors;

  try {
    ({ best, stores, errors } = await findBestStore());
  } catch (err) {
    dialog.showMessageBox(win, {
      type: 'error',
      message: 'Could not read the browser profiles',
      detail: err.message
    });
    return false;
  }

  if (best) {
    const { imported } = await importInto(session.defaultSession, best.store);
    if (imported > 0) {
      win.webContents.reload();
      if (!quiet) {
        dialog.showMessageBox(win, {
          type: 'info',
          message: `Signed in from ${best.store.browser}`,
          detail: `Imported ${imported} cookie${imported > 1 ? 's' : ''} — reloading.`
        });
      }
      return true;
    }
  }

  const has = (needle) => errors && errors.some((e) => e.includes(needle));
  let detail;

  if (has('LOCKED')) {
    const locked = errors
      .filter((e) => e.includes('LOCKED'))
      .map((e) => e.split(' (')[0])
      .join(', ');
    detail =
      `${locked} keeps its cookies locked while running, so they can't be read.\n\n` +
      'Fully quit the browser and try again:\n' +
      '  • close every window,\n' +
      '  • turn off Settings → System → "Continue running background apps when ' +
      'the browser is closed",\n' +
      '  • or right-click its taskbar/tray icon and choose Exit,\n' +
      'then click Import session again.\n\n' +
      "Firefox, Zen and LibreWolf don't need to be closed. Or, without closing " +
      'anything, export the cookies with a browser extension (Cookie-Editor) and ' +
      'use "Import session from cookies.json…".';
  } else if (has('APPBOUND')) {
    detail =
      'Your Chrome/Edge is signed in, but recent versions lock cookies to the ' +
      'browser itself (app-bound encryption), which no external app can read.\n\n' +
      'Easiest fix: sign in to soundcloud.com in Firefox (or Zen/LibreWolf) and ' +
      'import from there, or use SoundCloud email sign-in inside this app.';
  } else if (has('KEYRING')) {
    detail =
      'That profile encrypts its cookies with the desktop keyring, which this app cannot read.';
  } else {
    detail =
      'Sign in to soundcloud.com in your browser first, then try again.\n\nProfiles checked: ' +
      (stores && stores.length
        ? stores.map((store) => `${store.browser}/${store.profile}`).join(', ')
        : 'none found') +
      (errors && errors.length ? `\nErrors: ${errors.join('; ')}` : '');
  }

  dialog.showMessageBox(win, {
    type: 'warning',
    message: 'No SoundCloud session found in your browsers',
    detail
  });
  return false;
}

async function importSessionFromFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import SoundCloud cookies',
    message: 'Select a cookies.json exported from your browser (e.g. Cookie-Editor)',
    filters: [{ name: 'Cookies', extensions: ['json', 'txt'] }],
    properties: ['openFile']
  });

  if (canceled || !filePaths.length) return;

  let result;
  try {
    result = await importFromFile(session.defaultSession, filePaths[0]);
  } catch (err) {
    dialog.showMessageBox(win, {
      type: 'error',
      message: 'Could not read that file',
      detail: `${err.message}\n\nExport SoundCloud's cookies as JSON with a browser extension such as Cookie-Editor, then select that file.`
    });
    return;
  }

  if (result.imported > 0) {
    win.webContents.reload();
    dialog.showMessageBox(win, {
      type: 'info',
      message: `Imported ${result.imported} cookie${result.imported > 1 ? 's' : ''}`,
      detail: 'Reloading — you should be signed in.'
    });
  } else {
    dialog.showMessageBox(win, {
      type: 'warning',
      message: 'No SoundCloud cookies in that file',
      detail:
        'Make sure you exported the cookies while on soundcloud.com. The file ' +
        'should be a JSON array of cookie objects (Cookie-Editor / EditThisCookie format).'
    });
  }
}

function askDiscordId() {
  const prompt = new (require('electron').BrowserWindow)({
    parent: win,
    modal: true,
    width: 460,
    height: 260,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Discord Application ID',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/prompt-bridge.js'),
      contextIsolation: true,
      sandbox: true
    }
  });

  const current = store.get('discordClientId', '');
  ipcMain.handleOnce('prompt:initial', () => current);

  const finish = () => {
    ipcMain.removeAllListeners('prompt:submit');
    ipcMain.removeAllListeners('prompt:cancel');
    if (!prompt.isDestroyed()) prompt.close();
  };

  ipcMain.once('prompt:cancel', finish);
  ipcMain.once('prompt:submit', (_event, value) => {
    const id = String(value || '').replace(/[^0-9]/g, '');
    store.set('discordClientId', id);
    setupDiscord();
    discordKey = '';
    updateDiscord(lastState);
    finish();
    if (id) {
      dialog.showMessageBox(win, {
        type: 'info',
        message: 'Discord presence enabled',
        detail: 'Your currently playing track will show on your Discord profile.'
      });
    }
  });

  prompt.loadFile(path.join(__dirname, '../renderer/discord-id.html'));
  prompt.once('ready-to-show', () => prompt.show());
}

let signInInProgress = false;

async function signInWithBrowser() {
  if (signInInProgress) return;
  signInInProgress = true;

  let cookies;
  try {
    cookies = await signInViaBrowser({
      onReady: () => {
        dialog.showMessageBox(win, {
          type: 'info',
          message: 'Finish signing in in the browser window',
          detail:
            'A real browser just opened with a clean profile — sign in to ' +
            'SoundCloud there, with Google or any other method. This app picks ' +
            'the session up the moment you finish, then you can close that window.'
        });
      }
    });
  } catch (err) {
    signInInProgress = false;
    return handleLoginError(err);
  }

  const imported = await applyCookies(session.defaultSession, cookies);
  signInInProgress = false;

  if (imported > 0) {
    win.webContents.reload();
    win.show();
    win.focus();
  } else {
    dialog.showMessageBox(win, {
      type: 'warning',
      message: 'No session captured',
      detail: 'The browser closed before a SoundCloud session appeared. Try again.'
    });
  }
}

function handleLoginError(err) {
  if (err.message === 'NO_BROWSER') {
    shell.openExternal(SIGNIN_URL);
    dialog.showMessageBox(win, {
      type: 'info',
      message: 'No Chromium-based browser found',
      detail:
        'Google sign-in needs a real browser (Chrome, Chromium, Edge, Brave, ' +
        'Opera, Opera GX, Vivaldi or Yandex). SoundCloud just opened in your ' +
        'default browser instead — sign in there, then use ' +
        'File → Import session from browser.\n\nOr sign in with your SoundCloud ' +
        'email directly in this app, which needs no browser at all.'
    });
    return;
  }

  const quiet = ['CANCELLED', 'BROWSER_CLOSED', 'TIMEOUT'];
  dialog.showMessageBox(win, {
    type: quiet.includes(err.message) ? 'info' : 'error',
    message: quiet.includes(err.message) ? 'Sign-in not completed' : 'Sign-in failed',
    detail: quiet.includes(err.message)
      ? 'The browser closed before you finished. Try again when you are ready.'
      : err.message
  });
}

const SIGNIN_URL = 'https://soundcloud.com/signin';

function signIn() {
  if (!win || win.isDestroyed()) return;
  win.loadURL(SIGNIN_URL, { userAgent: USER_AGENT });
  win.show();
  win.focus();
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Home',
            accelerator: 'Alt+Home',
            click: () => win.loadURL(HOME_URL, { userAgent: USER_AGENT })
          },
          {
            label: 'Sign in with SoundCloud email…',
            click: signIn
          },
          {
            label: 'Sign in with Google / Facebook / Apple…',
            click: signInWithBrowser
          },
          {
            label: 'Import session from browser',
            click: () => importSession()
          },
          {
            label: 'Import session from cookies.json…',
            click: importSessionFromFile
          },
          {
            label: 'Open in browser',
            click: () => shell.openExternal(win.webContents.getURL())
          },
          { type: 'separator' },
          {
            label: 'Close to tray',
            type: 'checkbox',
            checked: store.get('closeToTray', true),
            click: (item) => store.set('closeToTray', item.checked)
          },
          {
            label: 'Track notifications',
            type: 'checkbox',
            checked: store.get('notifications', true),
            click: (item) => store.set('notifications', item.checked)
          },
          {
            label: 'Block ads and trackers',
            type: 'checkbox',
            checked: store.get('blockAds', true),
            click: (item) => {
              store.set('blockAds', item.checked);
              win.webContents.reload();
            }
          },
          {
            label: 'Discord Rich Presence',
            type: 'checkbox',
            checked: store.get('discordPresence', true),
            click: (item) => {
              store.set('discordPresence', item.checked);
              if (item.checked) {
                setupDiscord();
                discordKey = '';
                updateDiscord(lastState);
              } else if (discord) {
                discord.clear();
                discord.disconnect();
              }
            }
          },
          {
            label: 'Set Discord App ID…',
            click: askDiscordId
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: 'Ctrl+Q',
            click: () => {
              quitting = true;
              app.quit();
            }
          }
        ]
      },
      {
        label: 'Playback',
        submenu: [
          { label: 'Play / Pause', accelerator: 'Ctrl+P', click: () => send('playpause') },
          { label: 'Next', accelerator: 'Ctrl+Right', click: () => send('next') },
          { label: 'Previous', accelerator: 'Ctrl+Left', click: () => send('previous') },
          { label: 'Like', accelerator: 'Ctrl+L', click: () => send('like') }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' }
        ]
      },
      { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }
    ])
  );
}

function registerMediaKeys() {
  const bindings = {
    MediaPlayPause: 'playpause',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'previous'
  };
  for (const [key, command] of Object.entries(bindings)) {
    try {
      globalShortcut.register(key, () => send(command));
    } catch {
    }
  }
}

app.whenReady().then(() => {
  app.userAgentFallback = USER_AGENT;
  applyChromeIdentity(session.defaultSession);
  adblock = applyAdblock(session.defaultSession, () => store.get('blockAds', true));

  store = new Store('config');
  win = createWindow(store, { onProviderSignIn: () => signInWithBrowser() });
  buildMenu();
  setupDiscord();

  mpris = setupMpris(send, {
    raise: (uri) => {
      if (!win || win.isDestroyed()) return;
      if (typeof uri === 'string' && /^https:\/\/([a-z0-9-]+\.)*soundcloud\.com\//i.test(uri)) {
        win.loadURL(uri, { userAgent: USER_AGENT });
      }
      win.show();
      win.focus();
    },
    quit: () => {
      quitting = true;
      app.quit();
    }
  });
  if (!mpris) registerMediaKeys();

  tray = createTray({
    send,
    toggleWindow,
    quit: () => {
      quitting = true;
      app.quit();
    }
  });

  win.webContents.on('did-finish-load', () => adblock.injectCss(win.webContents));
  win.webContents.on('did-frame-finish-load', () => adblock.injectCss(win.webContents));

  win.on('close', (event) => {
    if (!quitting && store.get('closeToTray', true)) {
      event.preventDefault();
      win.hide();
    }
  });

  const debug = process.argv.includes('--dev');

  ipcMain.on('player:state', (_event, state) => {
    if (debug && state.trackChanged) {
      console.log('[bridge]', JSON.stringify(state));
    }
    if (mpris) mpris.update(state);
    tray.update(state);

    const changed =
      state.title !== lastState.title || state.artist !== lastState.artist;
    const startedPlaying = state.playing && !lastState.playing;
    lastState = state;

    if (changed || startedPlaying) notifyTrack(state);
    updateDiscord(state);
  });

  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
});

app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (discord) discord.disconnect();
});

app.on('window-all-closed', () => app.quit());
