const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { httpGetJson, connect } = require('./cdp');

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_FLATPAK = process.platform === 'linux' && fs.existsSync('/.flatpak-info');

function windowsCandidates() {
  const roots = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env['LOCALAPPDATA']
  ].filter(Boolean);
  const rel = [
    'Google\\Chrome\\Application\\chrome.exe',
    'Google\\Chrome Beta\\Application\\chrome.exe',
    'Chromium\\Application\\chrome.exe',
    'Microsoft\\Edge\\Application\\msedge.exe',
    'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'Vivaldi\\Application\\vivaldi.exe',
    'Yandex\\YandexBrowser\\Application\\browser.exe'
  ];
  const out = [];
  for (const root of roots) for (const r of rel) out.push(path.join(root, r));

  const local = process.env['LOCALAPPDATA'];
  if (local) {
    out.push(path.join(local, 'Programs\\Opera\\opera.exe'));
    out.push(path.join(local, 'Programs\\Opera GX\\opera.exe'));
    out.push(path.join(local, 'Programs\\Opera Beta\\opera.exe'));
  }
  return out;
}

function macCandidates() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
    '/Applications/Opera.app/Contents/MacOS/Opera',
    '/Applications/Opera GX.app/Contents/MacOS/Opera',
    '/Applications/Yandex.app/Contents/MacOS/Yandex'
  ];
}

function linuxCandidates() {
  const dirs = [
    '/usr/bin',
    '/usr/local/bin',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    path.join(os.homedir(), '.local/share/flatpak/exports/bin'),
    '/opt/google/chrome',
    '/opt/microsoft/msedge',
    '/opt/brave.com/brave',
    '/opt/vivaldi',
    '/opt/yandex/browser'
  ];
  const out = [];
  for (const dir of dirs) for (const n of CHROMIUM_BROWSER_NAMES) out.push(path.join(dir, n));
  return out;
}

const CHROMIUM_BROWSER_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'microsoft-edge-stable',
  'brave-browser',
  'vivaldi-stable',
  'vivaldi',
  'opera',
  'opera-gx',
  'yandex-browser'
];

const FLATPAK_BROWSER_NAMES = CHROMIUM_BROWSER_NAMES;

function findHostBrowserViaFlatpak() {
  const probe = FLATPAK_BROWSER_NAMES.map((n) => `command -v ${n}`).join(' || ');
  const result = spawnSync('flatpak-spawn', ['--host', 'sh', '-lc', probe], {
    encoding: 'utf8'
  });
  const line = (result.stdout || '').trim().split('\n')[0];
  return line || null;
}

function findBrowser() {
  if (IS_FLATPAK) return findHostBrowserViaFlatpak();
  const candidates = IS_WINDOWS
    ? windowsCandidates()
    : IS_MAC
      ? macCandidates()
      : linuxCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget(port) {
  const list = await httpGetJson(port, '/json/list');
  return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
}

function mapSameSite(value) {
  if (value === 'None') return 'no_restriction';
  if (value === 'Lax') return 'lax';
  if (value === 'Strict') return 'strict';
  return 'no_restriction';
}

async function signInViaBrowser({ onReady, shouldCancel } = {}) {
  const browser = findBrowser();
  if (!browser) throw new Error('NO_BROWSER');

  const port = await freePort();
  const profile = IS_FLATPAK
    ? `/tmp/sc-login-${process.pid}-${Date.now()}`
    : fs.mkdtempSync(path.join(os.tmpdir(), 'sc-login-'));

  const browserArgs = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--new-window',
    'about:blank'
  ];

  const command = IS_FLATPAK ? 'flatpak-spawn' : browser;
  const args = IS_FLATPAK ? ['--host', browser, ...browserArgs] : browserArgs;
  const child = spawn(command, args, { detached: false, stdio: 'ignore' });

  let childAlive = true;
  child.on('exit', () => {
    childAlive = false;
  });

  const cleanup = () => {
    try {
      if (childAlive) child.kill();
    } catch {
    }
    try {
      if (IS_FLATPAK) {
        spawnSync('flatpak-spawn', ['--host', 'rm', '-rf', profile]);
      } else {
        fs.rmSync(profile, { recursive: true, force: true });
      }
    } catch {
    }
  };

  try {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      if (!childAlive) throw new Error('BROWSER_CLOSED');
      try {
        target = await findPageTarget(port);
      } catch {
      }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error('NO_DEBUG_TARGET');

    try {
      const cdp = await connect(target.webSocketDebuggerUrl);
      await cdp.send('Page.navigate', { url: 'https://soundcloud.com/signin' });
      cdp.close();
    } catch {
    }

    if (onReady) onReady();

    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (shouldCancel && shouldCancel()) throw new Error('CANCELLED');
      if (!childAlive) throw new Error('BROWSER_CLOSED');

      const cookies = await readSoundCloudCookies(port).catch(() => []);
      const authed = cookies.some(
        (c) => c.name === 'oauth_token' && c.value && c.value.length > 5
      );
      if (authed) {
        cleanup();
        return cookies;
      }
      await sleep(1500);
    }
    throw new Error('TIMEOUT');
  } catch (err) {
    cleanup();
    throw err;
  }
}

async function readSoundCloudCookies(port) {
  const target = await findPageTarget(port);
  if (!target) return [];
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    const { cookies } = await cdp.send('Network.getCookies', {
      urls: [
        'https://soundcloud.com/',
        'https://secure.soundcloud.com/',
        'https://api-auth.soundcloud.com/',
        'https://api-v2.soundcloud.com/'
      ]
    });
    return (cookies || [])
      .filter((c) => c.domain.includes('soundcloud.com'))
      .map((c) => ({
        host: c.domain,
        name: c.name,
        value: c.value,
        path: c.path || '/',
        expires: c.session ? undefined : c.expires,
        secure: Boolean(c.secure),
        httpOnly: Boolean(c.httpOnly),
        sameSite: mapSameSite(c.sameSite)
      }));
  } finally {
    cdp.close();
  }
}

async function applyCookies(session, cookies) {
  const now = Date.now() / 1000;
  let imported = 0;
  for (const cookie of cookies) {
    if (!cookie.value) continue;
    if (cookie.expires && cookie.expires < now) continue;
    const domain = cookie.host.replace(/^\./, '');
    try {
      await session.cookies.set({
        url: `https://${domain}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.host,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: cookie.expires
      });
      imported += 1;
    } catch (err) {
      console.warn('[login] could not set', cookie.name, '-', err.message);
    }
  }
  return imported;
}

module.exports = { findBrowser, signInViaBrowser, applyCookies };
