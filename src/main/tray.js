const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

function createTray({ send, toggleWindow, quit }) {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, '../../build/icons/32x32.png'))
    .resize({ width: 22, height: 22 });

  const tray = new Tray(icon);
  tray.setToolTip('SoundCloud');

  let state = { hasTrack: false, playing: false, title: null, artist: null };

  const render = () => {
    const label = state.hasTrack
      ? `${state.title || 'Unknown'} — ${state.artist || 'SoundCloud'}`
      : 'Nothing playing';

    tray.setToolTip(state.hasTrack ? `SoundCloud · ${label}` : 'SoundCloud');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: label.length > 60 ? `${label.slice(0, 57)}…` : label, enabled: false },
        { type: 'separator' },
        {
          label: state.playing ? 'Pause' : 'Play',
          enabled: state.hasTrack,
          click: () => send('playpause')
        },
        { label: 'Next', enabled: state.hasTrack, click: () => send('next') },
        { label: 'Previous', enabled: state.hasTrack, click: () => send('previous') },
        { label: 'Like current track', enabled: state.hasTrack, click: () => send('like') },
        { type: 'separator' },
        { label: 'Show / hide window', click: toggleWindow },
        { label: 'Quit', click: quit }
      ])
    );
  };

  render();
  tray.on('click', toggleWindow);

  return {
    tray,
    update(next) {
      const changed =
        next.hasTrack !== state.hasTrack ||
        next.playing !== state.playing ||
        next.title !== state.title ||
        next.artist !== state.artist;
      state = next;
      if (changed) render();
    }
  };
}

module.exports = { createTray };
