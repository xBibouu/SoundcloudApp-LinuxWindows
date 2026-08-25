const BLOCKED_SUFFIXES = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'googletagservices.com',
  'adtrafficquality.google',
  'google-analytics.com',
  'aditude.io',
  'aditude.cloud',
  'htlbid.com',
  'amazon-adsystem.com',
  'publisher-services.amazon.dev',
  'id5-sync.com',
  'crwdcntrl.net',
  'fastclick.net',
  'adnxs.com',
  'pubmatic.com',
  'rubiconproject.com',
  'casalemedia.com',
  'openx.net',
  'criteo.com',
  'criteo.net',
  'sharethrough.com',
  'triplelift.com',
  '33across.com',
  'moatads.com',
  'scorecardresearch.com',
  'quantserve.com',
  'taboola.com',
  'outbrain.com'
];

const ALLOWED_SUFFIXES = ['sndcdn.com', 'soundcloud.com', 'gstatic.com'];

function matches(hostname, suffixes) {
  return suffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

function shouldBlock(url) {
  let hostname;
  try {
    ({ hostname } = new URL(url));
  } catch {
    return false;
  }
  if (matches(hostname, ALLOWED_SUFFIXES)) return false;
  return matches(hostname, BLOCKED_SUFFIXES);
}

const HIDE_CSS = `
  iframe[src*="safeframe"],
  iframe[id^="google_ads"],
  iframe[name^="google_ads"],
  ins.adsbygoogle,
  div[id^="div-gpt-ad"],
  div[id^="htlad-"],
  [class*="adWrapper"],
  [class*="ad-wrapper"],
  [data-testid="ad-container"] {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
  }
`;

function applyAdblock(session, isEnabled) {
  let blocked = 0;

  session.webRequest.onBeforeRequest((details, callback) => {
    if (isEnabled() && shouldBlock(details.url)) {
      blocked += 1;
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  return {
    get blocked() {
      return blocked;
    },
    injectCss(contents) {
      if (!isEnabled()) return;
      contents.insertCSS(HIDE_CSS).catch(() => {
      });
    }
  };
}

module.exports = { applyAdblock, shouldBlock, BLOCKED_SUFFIXES, HIDE_CSS };
