let dbus;
try {
  dbus = require('dbus-next');
} catch (err) {
  console.warn('[mpris] dbus-next unavailable:', err.message);
}

const BUS_NAME = 'org.mpris.MediaPlayer2.soundcloud';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';

function setupMpris(send, { raise, quit } = {}) {
  if (!dbus) return null;

  const { Interface, ACCESS_READ, ACCESS_READWRITE } = dbus.interface;
  const { Variant } = dbus;

  class RootInterface extends Interface {
    get Identity() { return 'SoundCloud'; }
    get DesktopEntry() { return 'soundcloud'; }
    get CanQuit() { return true; }
    get CanRaise() { return true; }
    get HasTrackList() { return false; }
    get SupportedUriSchemes() { return ['https']; }
    get SupportedMimeTypes() { return []; }
    Raise() { if (raise) raise(); }
    Quit() { if (quit) quit(); }
  }

  RootInterface.configureMembers({
    properties: {
      Identity: { signature: 's', access: ACCESS_READ },
      DesktopEntry: { signature: 's', access: ACCESS_READ },
      CanQuit: { signature: 'b', access: ACCESS_READ },
      CanRaise: { signature: 'b', access: ACCESS_READ },
      HasTrackList: { signature: 'b', access: ACCESS_READ },
      SupportedUriSchemes: { signature: 'as', access: ACCESS_READ },
      SupportedMimeTypes: { signature: 'as', access: ACCESS_READ }
    },
    methods: {
      Raise: { inSignature: '', outSignature: '' },
      Quit: { inSignature: '', outSignature: '' }
    }
  });

  class PlayerInterface extends Interface {
    constructor(name) {
      super(name);
      this._status = 'Stopped';
      this._metadata = {};
      this._position = 0;
    }

    get PlaybackStatus() { return this._status; }
    get Metadata() { return this._metadata; }
    get Position() { return BigInt(Math.round(this._position * 1e6)); }
    get Rate() { return 1.0; }
    set Rate(_value) {  }
    get MinimumRate() { return 1.0; }
    get MaximumRate() { return 1.0; }
    get Volume() { return 1.0; }
    set Volume(_value) {  }
    get CanGoNext() { return true; }
    get CanGoPrevious() { return true; }
    get CanPlay() { return true; }
    get CanPause() { return true; }
    get CanSeek() { return false; }
    get CanControl() { return true; }

    Play() { send('play'); }
    Pause() { send('pause'); }
    PlayPause() { send('playpause'); }
    Stop() { send('pause'); }
    Next() { send('next'); }
    Previous() { send('previous'); }
    Seek(_offset) {  }
    SetPosition(_path, _position) {  }
    OpenUri(uri) { if (raise) raise(uri); }
  }

  PlayerInterface.configureMembers({
    properties: {
      PlaybackStatus: { signature: 's', access: ACCESS_READ },
      Metadata: { signature: 'a{sv}', access: ACCESS_READ },
      Position: { signature: 'x', access: ACCESS_READ },
      Rate: { signature: 'd', access: ACCESS_READWRITE },
      MinimumRate: { signature: 'd', access: ACCESS_READ },
      MaximumRate: { signature: 'd', access: ACCESS_READ },
      Volume: { signature: 'd', access: ACCESS_READWRITE },
      CanGoNext: { signature: 'b', access: ACCESS_READ },
      CanGoPrevious: { signature: 'b', access: ACCESS_READ },
      CanPlay: { signature: 'b', access: ACCESS_READ },
      CanPause: { signature: 'b', access: ACCESS_READ },
      CanSeek: { signature: 'b', access: ACCESS_READ },
      CanControl: { signature: 'b', access: ACCESS_READ }
    },
    methods: {
      Play: { inSignature: '', outSignature: '' },
      Pause: { inSignature: '', outSignature: '' },
      PlayPause: { inSignature: '', outSignature: '' },
      Stop: { inSignature: '', outSignature: '' },
      Next: { inSignature: '', outSignature: '' },
      Previous: { inSignature: '', outSignature: '' },
      Seek: { inSignature: 'x', outSignature: '' },
      SetPosition: { inSignature: 'ox', outSignature: '' },
      OpenUri: { inSignature: 's', outSignature: '' }
    },
    signals: {
      Seeked: { signature: 'x' }
    }
  });

  let bus;
  const root = new RootInterface('org.mpris.MediaPlayer2');
  const player = new PlayerInterface('org.mpris.MediaPlayer2.Player');

  try {
    bus = dbus.sessionBus();
    bus.export(OBJECT_PATH, root);
    bus.export(OBJECT_PATH, player);
    bus.requestName(BUS_NAME).catch((err) =>
      console.warn('[mpris] could not take the bus name:', err.message)
    );
  } catch (err) {
    console.warn('[mpris] could not connect to the session bus:', err.message);
    return null;
  }

  let trackCounter = 0;
  let currentKey = '';

  const update = (state) => {
    player._position = state.position || 0;
    const changed = {};
    const key = `${state.title}|${state.artist}`;

    if (state.hasTrack && key !== currentKey) {
      currentKey = key;
      const metadata = {
        'mpris:trackid': new Variant('o', `${OBJECT_PATH}/track/${trackCounter++}`),
        'mpris:length': new Variant('x', BigInt(Math.round((state.duration || 0) * 1e6))),
        'xesam:title': new Variant('s', state.title || 'Unknown track'),
        'xesam:artist': new Variant('as', [state.artist || 'SoundCloud'])
      };
      if (state.artwork) metadata['mpris:artUrl'] = new Variant('s', state.artwork);
      if (state.url) metadata['xesam:url'] = new Variant('s', state.url);
      player._metadata = metadata;
      changed.Metadata = metadata;
    }

    if (!state.hasTrack && currentKey) {
      currentKey = '';
      player._metadata = {};
      changed.Metadata = {};
    }

    const status = state.hasTrack ? (state.playing ? 'Playing' : 'Paused') : 'Stopped';
    if (status !== player._status) {
      player._status = status;
      changed.PlaybackStatus = status;
    }

    if (Object.keys(changed).length) {
      Interface.emitPropertiesChanged(player, changed, []);
    }
  };

  return { player, update };
}

module.exports = { setupMpris };
