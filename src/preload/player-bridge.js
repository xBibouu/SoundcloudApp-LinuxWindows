const { ipcRenderer } = require('electron');

const SEL = {
  play: ['.playControls__play'],
  next: ['.skipControl__next'],
  prev: ['.skipControl__previous'],
  shuffle: ['.shuffleControl'],
  repeat: ['.repeatControl'],
  like: ['.playbackSoundBadge .sc-button-like', '.playControls .sc-button-like'],
  title: ['.playbackSoundBadge__titleLink', '.playbackSoundBadge a[href^="/"][title]'],
  artist: ['.playbackSoundBadge__lightLink', '.playbackSoundBadge__context a'],
  artwork: ['.playbackSoundBadge span.sc-artwork', '.playControls .sc-artwork'],
  progress: ['.playbackTimeline__progressWrapper', '[role="progressbar"].playbackTimeline__progressWrapper'],
  timePassed: ['.playbackTimeline__timePassed'],
  duration: ['.playbackTimeline__duration']
};

function $(key) {
  for (const selector of SEL[key]) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function click(sel) {
  const el = $(sel);
  if (el) {
    el.click();
    return true;
  }
  return false;
}

function isPlaying() {
  const btn = $('play');
  if (btn && (btn.classList.contains('playing') || btn.classList.contains('sc-button-pause'))) {
    return true;
  }
  const media = document.querySelector('audio, video');
  if (media && !media.paused && !media.ended) return true;
  return false;
}

function hasTrack() {
  const btn = $('play');
  if (btn && btn.classList.contains('disabled')) return false;
  return Boolean($('title'));
}

function parseTime(text) {
  if (!text) return 0;
  const parts = String(text).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function timeFrom(sel) {
  const el = $(sel);
  if (!el) return 0;
  const visible = el.querySelector('[aria-hidden="true"]');
  return parseTime(visible ? visible.textContent : el.textContent);
}

function readProgress() {
  const bar = $('progress');
  if (bar && bar.getAttribute('aria-valuemax')) {
    return {
      position: Number(bar.getAttribute('aria-valuenow')) || 0,
      duration: Number(bar.getAttribute('aria-valuemax')) || 0
    };
  }
  return { position: timeFrom('timePassed'), duration: timeFrom('duration') };
}

function readArtwork() {
  const el = $('artwork');
  if (!el) return null;
  const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage;
  const match = /url\(["']?(.*?)["']?\)/.exec(bg || '');
  if (!match) return null;
  return match[1].replace(/-(t?\d+x\d+|badge|small|tiny|mini)\./, '-t500x500.');
}

function normalize(raw) {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.replace(/^\s*(titre en cours|lecture en cours|now playing|current track)\s*:?\s*/i, '');
  s = dedupe(s);
  return s.trim() || null;
}

function dedupe(input) {
  const s = input.trim();
  for (const gap of [0, 1]) {
    if ((s.length - gap) % 2 !== 0) continue;
    const half = (s.length - gap) / 2;
    if (half < 6) continue;
    const a = s.slice(0, half);
    const b = s.slice(half + gap);
    if (a === b && (gap === 0 || /\s/.test(s[half]))) return a.trim();
  }
  return s;
}

function cleanText(el) {
  if (!el) return null;
  const attr = el.getAttribute('title');
  if (attr && attr.trim()) return normalize(attr);
  const clone = el.cloneNode(true);
  clone
    .querySelectorAll('.sc-visuallyhidden, [aria-hidden="true"]')
    .forEach((n) => n.remove());
  return normalize(clone.textContent);
}

function readState() {
  const title = $('title');
  const artist = $('artist');
  const { position, duration } = readProgress();
  return {
    title: cleanText(title),
    artist: cleanText(artist),
    url: title ? title.href : null,
    artwork: readArtwork(),
    playing: isPlaying(),
    position,
    duration,
    hasTrack: hasTrack()
  };
}

let last = '';
let lastTrackKey = '';

function push(force = false) {
  let state;
  try {
    state = readState();
  } catch {
    return;
  }
  const trackKey = `${state.title}|${state.artist}|${state.playing}`;
  const snapshot = JSON.stringify(state);
  if (!force && snapshot === last) return;
  last = snapshot;

  const trackChanged = trackKey !== lastTrackKey;
  lastTrackKey = trackKey;
  ipcRenderer.send('player:state', { ...state, trackChanged });
}

const COMMANDS = {
  playpause: () => click('play'),
  play: () => (isPlaying() ? false : click('play')),
  pause: () => (isPlaying() ? click('play') : false),
  next: () => click('next'),
  previous: () => click('prev'),
  like: () => click('like'),
  shuffle: () => click('shuffle'),
  repeat: () => click('repeat')
};

ipcRenderer.on('player:command', (_event, name) => {
  const run = COMMANDS[name];
  if (run) {
    run();
    setTimeout(() => push(true), 120);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  push(true);
  setInterval(push, 500);

  const observer = new MutationObserver(() => push());
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-label', 'aria-valuenow', 'title', 'style']
  });
});
