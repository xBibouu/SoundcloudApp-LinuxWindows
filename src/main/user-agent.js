const os = require('os');

const CHROME_FULL_VERSION = process.versions.chrome || '130.0.6723.191';
const CHROME_VERSION = CHROME_FULL_VERSION.split('.')[0];

const PLATFORMS = {
  win32: {
    uaPlatform: 'Windows NT 10.0; Win64; x64',
    chPlatform: '"Windows"',
    chPlatformVersion: '"15.0.0"'
  },
  darwin: {
    uaPlatform: 'Macintosh; Intel Mac OS X 10_15_7',
    chPlatform: '"macOS"',
    chPlatformVersion: '"14.6.0"'
  },
  linux: {
    uaPlatform: 'X11; Linux x86_64',
    chPlatform: '"Linux"',
    chPlatformVersion: `"${os.release().split('-')[0]}"`
  }
};

const PLATFORM = PLATFORMS[process.platform] || PLATFORMS.linux;

const USER_AGENT =
  `Mozilla/5.0 (${PLATFORM.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

const CLIENT_HINTS = {
  'sec-ch-ua':
    `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", ` +
    '"Not_A Brand";v="24"',
  'sec-ch-ua-full-version-list':
    `"Google Chrome";v="${CHROME_FULL_VERSION}", "Chromium";v="${CHROME_FULL_VERSION}", ` +
    '"Not_A Brand";v="24.0.0.0"',
  'sec-ch-ua-full-version': `"${CHROME_FULL_VERSION}"`,
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': PLATFORM.chPlatform,
  'sec-ch-ua-platform-version': PLATFORM.chPlatformVersion,
  'sec-ch-ua-arch': '"x86"',
  'sec-ch-ua-bitness': '"64"',
  'sec-ch-ua-model': '""'
};

function applyChromeIdentity(session) {
  session.setUserAgent(USER_AGENT);

  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    headers['User-Agent'] = USER_AGENT;

    for (const [name, value] of Object.entries(CLIENT_HINTS)) {
      const existing = Object.keys(headers).find(
        (key) => key.toLowerCase() === name
      );
      if (existing) headers[existing] = value;
    }

    callback({ requestHeaders: headers });
  });
}

module.exports = { USER_AGENT, applyChromeIdentity };
