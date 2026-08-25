const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { applyWal } = require('./sqlite-wal');
const { dpapiUnprotect, copyLockedFile } = require('./win-dpapi');

const HOME = os.homedir();
const IS_WINDOWS = process.platform === 'win32';
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData/Local');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData/Roaming');

const LINUX_CHROMIUM_ROOTS = [
  { name: 'Chromium (snap)', dir: path.join(HOME, 'snap/chromium/common/chromium') },
  { name: 'Chromium', dir: path.join(HOME, '.config/chromium') },
  {
    name: 'Chromium (Flatpak)',
    dir: path.join(HOME, '.var/app/org.chromium.Chromium/config/chromium')
  },
  { name: 'Google Chrome', dir: path.join(HOME, '.config/google-chrome') },
  { name: 'Google Chrome Beta', dir: path.join(HOME, '.config/google-chrome-beta') },
  { name: 'Google Chrome Dev', dir: path.join(HOME, '.config/google-chrome-unstable') },
  {
    name: 'Google Chrome (Flatpak)',
    dir: path.join(HOME, '.var/app/com.google.Chrome/config/google-chrome')
  },
  { name: 'Brave', dir: path.join(HOME, '.config/BraveSoftware/Brave-Browser') },
  {
    name: 'Brave (Flatpak)',
    dir: path.join(HOME, '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser')
  },
  { name: 'Vivaldi', dir: path.join(HOME, '.config/vivaldi') },
  {
    name: 'Vivaldi (Flatpak)',
    dir: path.join(HOME, '.var/app/com.vivaldi.Vivaldi/config/vivaldi')
  },
  { name: 'Opera', dir: path.join(HOME, '.config/opera') },
  { name: 'Opera GX', dir: path.join(HOME, '.config/opera-gx') },
  { name: 'Microsoft Edge', dir: path.join(HOME, '.config/microsoft-edge') },
  {
    name: 'Microsoft Edge (Flatpak)',
    dir: path.join(HOME, '.var/app/com.microsoft.Edge/config/microsoft-edge')
  },
  { name: 'Yandex', dir: path.join(HOME, '.config/yandex-browser') }
];

const WINDOWS_CHROMIUM_ROOTS = [
  { name: 'Google Chrome', dir: path.join(LOCALAPPDATA, 'Google/Chrome/User Data') },
  { name: 'Google Chrome Beta', dir: path.join(LOCALAPPDATA, 'Google/Chrome Beta/User Data') },
  { name: 'Google Chrome SxS', dir: path.join(LOCALAPPDATA, 'Google/Chrome SxS/User Data') },
  { name: 'Chromium', dir: path.join(LOCALAPPDATA, 'Chromium/User Data') },
  { name: 'Microsoft Edge', dir: path.join(LOCALAPPDATA, 'Microsoft/Edge/User Data') },
  {
    name: 'Brave',
    dir: path.join(LOCALAPPDATA, 'BraveSoftware/Brave-Browser/User Data')
  },
  { name: 'Vivaldi', dir: path.join(LOCALAPPDATA, 'Vivaldi/User Data') },
  { name: 'Opera', dir: path.join(APPDATA, 'Opera Software/Opera Stable') },
  { name: 'Opera GX', dir: path.join(APPDATA, 'Opera Software/Opera GX Stable') },
  { name: 'Yandex', dir: path.join(LOCALAPPDATA, 'Yandex/YandexBrowser/User Data') }
];

const CHROMIUM_PROFILES = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
const CHROMIUM_COOKIE_PATHS = ['Network/Cookies', 'Cookies'];

const LINUX_FIREFOX_ROOTS = [
  { name: 'Firefox', dir: path.join(HOME, '.mozilla/firefox') },
  { name: 'Firefox (snap)', dir: path.join(HOME, 'snap/firefox/common/.mozilla/firefox') },
  {
    name: 'Firefox (Flatpak)',
    dir: path.join(HOME, '.var/app/org.mozilla.firefox/.mozilla/firefox')
  },
  { name: 'Zen', dir: path.join(HOME, '.zen') },
  { name: 'Zen (Flatpak)', dir: path.join(HOME, '.var/app/app.zen_browser.zen/.zen') },
  { name: 'Zen', dir: path.join(HOME, '.config/zen') },
  { name: 'LibreWolf', dir: path.join(HOME, '.librewolf') },
  {
    name: 'LibreWolf (Flatpak)',
    dir: path.join(HOME, '.var/app/io.gitlab.librewolf-community/.librewolf')
  },
  { name: 'Waterfox', dir: path.join(HOME, '.waterfox') },
  { name: 'Floorp', dir: path.join(HOME, '.floorp') },
  {
    name: 'Floorp (Flatpak)',
    dir: path.join(HOME, '.var/app/one.ablaze.floorp/.floorp')
  },
  { name: 'Tor Browser', dir: path.join(HOME, '.tb/tor-browser/Browser/TorBrowser/Data/Browser') }
];

const WINDOWS_FIREFOX_ROOTS = [
  { name: 'Firefox', dir: path.join(APPDATA, 'Mozilla/Firefox/Profiles') },
  { name: 'Zen', dir: path.join(APPDATA, 'zen/Profiles') },
  { name: 'LibreWolf', dir: path.join(APPDATA, 'librewolf/Profiles') },
  { name: 'Waterfox', dir: path.join(APPDATA, 'Waterfox/Profiles') },
  { name: 'Floorp', dir: path.join(APPDATA, 'Floorp/Profiles') }
];

const CHROMIUM_ROOTS = IS_WINDOWS ? WINDOWS_CHROMIUM_ROOTS : LINUX_CHROMIUM_ROOTS;
const FIREFOX_ROOTS = IS_WINDOWS ? WINDOWS_FIREFOX_ROOTS : LINUX_FIREFOX_ROOTS;

function findChromiumCookieFile(profileDir) {
  for (const rel of CHROMIUM_COOKIE_PATHS) {
    const file = path.join(profileDir, rel);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function findCookieStores() {
  const found = [];

  for (const root of CHROMIUM_ROOTS) {
    for (const profile of CHROMIUM_PROFILES) {
      const file = findChromiumCookieFile(path.join(root.dir, profile));
      if (file) {
        found.push({
          browser: root.name,
          profile,
          file,
          kind: 'chromium',
          userDataDir: root.dir
        });
      }
    }
  }

  for (const root of FIREFOX_ROOTS) {
    let entries;
    try {
      entries = fs.readdirSync(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root.dir, entry.name, 'cookies.sqlite');
      if (fs.existsSync(file)) {
        found.push({ browser: root.name, profile: entry.name, file, kind: 'firefox' });
      }
    }
  }

  return found;
}

const V10_KEY = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
const IV = Buffer.alloc(16, ' ');

function isPrintable(value) {
  return !/[\x00-\x08\x0e-\x1f]/.test(value);
}

function stripHostHash(buffer) {
  const asIs = buffer.toString('utf8');
  return isPrintable(asIs) ? asIs : buffer.subarray(32).toString('utf8');
}

function decryptLinux(encrypted, plain) {
  const version = encrypted.subarray(0, 3).toString('latin1');
  if (version === 'v11') throw new Error('KEYRING');
  if (version !== 'v10') return plain || '';

  const decipher = crypto.createDecipheriv('aes-128-cbc', V10_KEY, IV);
  decipher.setAutoPadding(false);
  let out = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);

  const padding = out[out.length - 1];
  if (padding > 0 && padding <= 16) out = out.subarray(0, out.length - padding);
  return stripHostHash(out);
}

function loadWindowsAesKey(userDataDir) {
  const localState = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8')
  );
  const encoded = localState.os_crypt && localState.os_crypt.encrypted_key;
  if (!encoded) throw new Error('NO_KEY');

  const blob = Buffer.from(encoded, 'base64');
  if (blob.subarray(0, 5).toString('latin1') !== 'DPAPI') throw new Error('NO_KEY');
  return dpapiUnprotect(blob.subarray(5));
}

function decryptWindows(encrypted, aesKey) {
  const version = encrypted.subarray(0, 3).toString('latin1');

  if (version === 'v20') throw new Error('APPBOUND');

  if (version === 'v10' || version === 'v11') {
    if (!aesKey) throw new Error('NO_KEY');
    const nonce = encrypted.subarray(3, 15);
    const tag = encrypted.subarray(encrypted.length - 16);
    const ciphertext = encrypted.subarray(15, encrypted.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return stripHostHash(out);
  }

  if (encrypted.length > 4 && encrypted.readUInt32LE(0) === 1) {
    return stripHostHash(dpapiUnprotect(encrypted));
  }

  return '';
}

const EPOCH_OFFSET_SECONDS = 11644473600;
const SAME_SITE = { 0: 'no_restriction', 1: 'lax', 2: 'strict' };

let sqlPromise = null;

function loadSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      wasmBinary: fs.readFileSync(
        path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm')
      )
    });
  }
  return sqlPromise;
}

function readMaybeLocked(file) {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if (IS_WINDOWS && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
      const copy = path.join(os.tmpdir(), `sc-db-${process.pid}-${Date.now()}-${path.basename(file)}`);
      try {
        copyLockedFile(file, copy);
      } catch {
        throw new Error('LOCKED');
      }
      try {
        return fs.readFileSync(copy);
      } finally {
        fs.rmSync(copy, { force: true });
      }
    }
    throw err;
  }
}

function readWal(file) {
  const wal = `${file}-wal`;
  try {
    if (!fs.existsSync(wal)) return null;
    return readMaybeLocked(wal);
  } catch {
    return null;
  }
}

async function openDatabase(file) {
  const SQL = await loadSql();
  const main = readMaybeLocked(file);
  const wal = readWal(file);
  return new SQL.Database(wal ? applyWal(main, wal) : main);
}

function normalizeExpiry(raw) {
  const value = Number(raw);
  if (!value) return undefined;
  if (value > 1e14) return value / 1e6;
  if (value > 1e11) return value / 1e3;
  return value;
}

function buildQuery(kind, hostLike) {
  const like = `'%${hostLike}'`;
  if (kind === 'chromium') {
    return `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                   is_secure, is_httponly, samesite
              FROM cookies
             WHERE host_key LIKE ${like}`;
  }
  return `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
            FROM moz_cookies
           WHERE host LIKE ${like}`;
}

function makeChromiumDecryptor(store) {
  if (!IS_WINDOWS) return (encrypted, plain) => decryptLinux(encrypted, plain);

  let aesKey = null;
  let keyError = null;
  try {
    aesKey = loadWindowsAesKey(store.userDataDir);
  } catch (err) {
    keyError = err;
  }

  let appBound = 0;
  return (encrypted, plain) => {
    try {
      return decryptWindows(encrypted, aesKey);
    } catch (err) {
      if (err.message === 'APPBOUND') {
        appBound += 1;
        if (appBound === 1) throw new Error('APPBOUND');
        return '';
      }
      if (err.message === 'NO_KEY' && keyError) throw keyError;
      return '';
    }
  };
}

async function readCookies(store, hostLike = 'soundcloud.com') {
  const db = await openDatabase(store.file);
  try {
    const result = db.exec(buildQuery(store.kind, hostLike));
    if (!result.length) return [];

    if (store.kind === 'chromium') {
      const decrypt = makeChromiumDecryptor(store);
      return result[0].values.map((row) => {
        const [host, name, value, encrypted, cookiePath, expires, secure, httpOnly, sameSite] =
          row;
        const buffer = encrypted && encrypted.length ? Buffer.from(encrypted) : null;
        return {
          host,
          name,
          value: buffer ? decrypt(buffer, value) : value || '',
          path: cookiePath || '/',
          expires: expires ? Number(expires) / 1e6 - EPOCH_OFFSET_SECONDS : undefined,
          secure: Boolean(secure),
          httpOnly: Boolean(httpOnly),
          sameSite: SAME_SITE[sameSite] || 'no_restriction'
        };
      });
    }

    return result[0].values.map((row) => {
      const [host, name, value, cookiePath, expiry, secure, httpOnly, sameSite] = row;
      return {
        host,
        name,
        value: value || '',
        path: cookiePath || '/',
        expires: normalizeExpiry(expiry),
        secure: Boolean(secure),
        httpOnly: Boolean(httpOnly),
        sameSite: SAME_SITE[sameSite] || 'no_restriction'
      };
    });
  } finally {
    db.close();
  }
}

async function importInto(session, store) {
  const cookies = await readCookies(store);
  let imported = 0;

  const now = Date.now() / 1000;

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
      console.warn('[cookies] could not set', cookie.name, '-', err.message);
    }
  }

  return { found: cookies.length, imported };
}

const SAME_SITE_NAMES = {
  no_restriction: 'no_restriction',
  none: 'no_restriction',
  unspecified: 'no_restriction',
  lax: 'lax',
  strict: 'strict'
};

function normalizeExported(cookie) {
  const host = cookie.domain || cookie.host || '';
  if (!host.includes('soundcloud.com')) return null;
  const name = cookie.name;
  const value = cookie.value;
  if (!name || value == null) return null;

  let sameSite = 'no_restriction';
  if (typeof cookie.sameSite === 'string') {
    sameSite = SAME_SITE_NAMES[cookie.sameSite.toLowerCase()] || 'no_restriction';
  }

  let expires;
  if (cookie.expirationDate) expires = Number(cookie.expirationDate);
  else if (cookie.expires) expires = normalizeExpiry(cookie.expires);

  return {
    host,
    name,
    value: String(value),
    path: cookie.path || '/',
    expires,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly || cookie.httponly),
    sameSite
  };
}

async function importFromFile(session, filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.cookies)
      ? parsed.cookies
      : [];

  const cookies = raw.map(normalizeExported).filter(Boolean);
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
      console.warn('[cookies] could not set', cookie.name, '-', err.message);
    }
  }

  return { found: cookies.length, imported };
}

async function findBestStore() {
  const stores = findCookieStores();
  const scored = [];
  const errors = [];

  for (const store of stores) {
    try {
      const cookies = await readCookies(store);
      if (cookies.length) scored.push({ store, count: cookies.length });
    } catch (err) {
      errors.push(`${store.browser} (${store.profile}): ${err.message}`);
    }
  }

  scored.sort((a, b) => b.count - a.count);
  return { best: scored[0] || null, stores, errors };
}

async function readHostCookies(hostLike) {
  const stores = findCookieStores();
  let best = [];
  for (const store of stores) {
    try {
      const cookies = await readCookies(store, hostLike);
      if (cookies.length > best.length) best = cookies;
    } catch {
    }
  }
  return best.filter((c) => c.value);
}

module.exports = {
  findCookieStores,
  findBestStore,
  importInto,
  importFromFile,
  readHostCookies
};
