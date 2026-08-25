<div align="center">

# 🎧 SoundcloudApp-LinuxWindows

**SoundCloud as a real desktop app on Linux and Windows — media keys, tray,
MPRIS, Discord Rich Presence and no ads.**

[![License](https://img.shields.io/badge/License-MIT-6e7781?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-2b2e3a?style=for-the-badge&logo=electron&logoColor=9feaf9)](https://www.electronjs.org/)
[![Issues](https://img.shields.io/github/issues/xBibouu/SoundcloudApp-LinuxWindows?style=for-the-badge&logo=github&logoColor=white&color=444d56)](https://github.com/xBibouu/SoundcloudApp-LinuxWindows/issues)

![Ubuntu](https://img.shields.io/badge/Ubuntu-E95420?style=flat-square&logo=ubuntu&logoColor=white)
![Debian](https://img.shields.io/badge/Debian-A81D33?style=flat-square&logo=debian&logoColor=white)
![Fedora](https://img.shields.io/badge/Fedora-51A2DA?style=flat-square&logo=fedora&logoColor=white)
![Arch](https://img.shields.io/badge/Arch-1793D1?style=flat-square&logo=archlinux&logoColor=white)
![Flatpak](https://img.shields.io/badge/Flatpak-4A90D9?style=flat-square&logo=flatpak&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D4?style=flat-square&logo=windows&logoColor=white)

![SoundcloudApp-LinuxWindows](screenshot.png)

</div>

## What it is

The SoundCloud web player, wrapped in Electron, with the desktop integration a
browser tab cannot give you. Your media keys control it, it sits in your tray,
it shows up in your desktop's media widget, it puts the track you're playing on
your Discord profile, and it blocks the ads.

It's the real SoundCloud, signed in with your own account, so your likes,
playlists, history and recommendations are all there. Nothing goes through a
third party.

## Features

**It behaves like a music player, not a website**

- **Media keys** — play/pause, next and previous work even when the window is
  buried behind everything else.
- **Tray icon** with play/pause, next, previous, like and show/hide.
- **MPRIS / D-Bus** — appears in the GNOME media widget, KDE's media applet and
  `playerctl`, with the track title, artist and cover.
- **Notifications** on track change, with the cover art.
- **Close to tray**, so the music keeps going when you close the window.
- Window size and position come back where you left them.

**Discord Rich Presence**

Your current track and artist on your Discord profile, as a *Listening*
activity with a progress bar. Toggle and application ID are both in the File
menu.

> Discord does not draw Rich Presence buttons on your *own* profile. If you
> don't see the button, ask someone else to look — that's the only way to check.

**No ads**

On by default, and switchable from the File menu. The blocklist was built from
the hosts soundcloud.com actually contacts, not from a generic filter list, and
the audio and artwork domains are explicitly allow-listed so no rule can ever
mute the player.

> This blocks display and tracking requests. **Audio ads are not blocked** —
> SoundCloud serves those through the same API as normal tracks.

## Install

No releases are published yet, so build it yourself — it takes one command, see
[Build](#build) below. The artifacts land in `dist/`.

| Format | Best for | How to start it |
|---|---|---|
| AppImage | Most Linux desktops | `./SoundcloudAppLinuxWindows-*.AppImage` |
| Flatpak | Sandboxed, recommended on Linux | `flatpak install --user --bundle dist/*.flatpak` |
| `.deb` | Debian, Ubuntu, Mint | `sudo apt install ./soundcloud-app-linux-windows_*_amd64.deb` |
| `.rpm` | Fedora, openSUSE | `sudo dnf install ./soundcloud-app-linux-windows-*.x86_64.rpm` |
| `Setup.exe` | Windows | run the installer |
| `portable.exe` | Windows, no install | run it |

If you're not sure, take the AppImage: it runs nearly everywhere and needs
nothing installed.

## Signing in

**With a SoundCloud email and password** — File ▸ *Sign in with SoundCloud
email…*. Happens entirely inside the app.

**With Google, Facebook or Apple** — File ▸ *Sign in with Google / Facebook /
Apple…*, or just click the provider button on the page. A real browser opens,
you sign in there, and the app picks up the session by itself the moment you're
done. Close the browser and carry on.

> That detour isn't laziness, it's a requirement. Google refuses OAuth from
> embedded browsers and doesn't go by the User-Agent alone: `userAgentData`
> still reports "Chromium" with no "Google Chrome" brand, and `window.chrome`
> is nearly empty. Electron cannot hide either. Any Chromium-family browser
> does the job — Chrome, Chromium, Edge, Brave, Opera, Opera GX, Vivaldi or
> Yandex.

**Already signed in elsewhere?** *Import session from browser* lifts an existing
soundcloud.com session out of an installed browser profile. Firefox-family
browsers (Firefox, Zen, LibreWolf, Floorp, Waterfox) always work; Chromium
profiles that encrypt with the desktop keyring, and recent Chrome/Edge versions
using app-bound encryption, cannot be read. *Import session from cookies.json…*
takes a Cookie-Editor style export.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Play / pause |
| `Ctrl+←` / `Ctrl+→` | Previous / next |
| `Ctrl+L` | Like current track |
| `Alt+Home` | Back to the SoundCloud home page |
| `Ctrl+Q` | Quit |

Plus your keyboard's own media keys, which work globally.

## What you need

- A 64-bit Linux desktop or Windows 10/11.
- Node 18+ and npm, to build it.
- Nothing else. No account is needed to browse, only to use your own library.

## Build

```bash
npm install
npm start                # run from source

npm run dist:linux       # AppImage + deb + rpm + Flatpak
npm run dist:win         # Windows installer + portable (needs wine on Linux)
npm run dist             # everything
npm run checksums        # SHA256SUMS for everything in dist/
```

Per-target prerequisites: `.deb` needs `binutils`, `.rpm` needs `rpm`, the
Windows targets need `wine`, Flatpak needs `flatpak-builder` and its runtimes.
The AppImage needs none of them.

> A missing `rpmbuild` aborts the whole run *before* the later targets are
> built. Drop `rpm` from the target list if you don't have it.

<details>
<summary><b>Flatpak, in full</b></summary>

```bash
sudo apt install flatpak-builder
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Sdk//24.08 org.electronjs.Electron2.BaseApp//24.08
npm run dist:flatpak
flatpak install --user --reinstall --bundle dist/SoundcloudAppLinuxWindows-0.1.0-x86_64.flatpak
flatpak run io.github.gato.soundcloud
```

Rebuilding the bundle does **not** update an installed copy — repeat the
`flatpak install --bundle` step. It's a local bundle, not a repository, so
`flatpak update` will never see it.

Startup prints a few `Failed to connect to socket /run/dbus/system_bus_socket`
lines: Chromium probing the *system* bus, which Flatpak deliberately doesn't
expose. Harmless — the session bus, where MPRIS lives, works.

</details>

## If something goes wrong

`npm run dev` opens DevTools and logs every playback-state change the page
bridge reports, prefixed with `[bridge]`. It also logs Discord `setActivity`
rejections, which are otherwise completely silent.

**Nothing plays / the window is blank.** SoundCloud changes its markup from time
to time and the player state is read straight out of the page. The selectors are
at the top of `src/preload/player-bridge.js` — that's the one place to fix.

**`npm start` dies on a `chrome-sandbox` error.** Electron's sandbox helper has
to be root-owned and setuid, which npm can't do at install time:

```bash
npm run fix-sandbox      # sudo chown root + chmod 4755
```

Or use `npm run start:nosandbox`. Packaged builds handle this themselves, so it
only ever affects running from source.

Still stuck? [Open an issue](https://github.com/xBibouu/SoundcloudApp-LinuxWindows/issues)
with your distribution, how you installed it and what `npm run dev` printed —
but never your account details or cookies.

## How it works

| Path | Role |
|---|---|
| `src/main/index.js` | entry point, menus, tray wiring, Discord updates |
| `src/main/window.js` | window creation, navigation and popup routing |
| `src/preload/player-bridge.js` | reads playback state out of the SoundCloud page |
| `src/main/mpris.js` | MPRIS / D-Bus interface |
| `src/main/adblock.js` | request blocking and cosmetic filtering |
| `src/main/discord-presence.js` | Discord RPC client |
| `src/main/browser-login.js` | provider sign-in through a real browser |
| `src/main/cookie-import.js` | reads sessions out of browser cookie stores |
| `src/main/cdp.js` | dependency-free Chrome DevTools Protocol client |
| `src/main/user-agent.js` | Chrome identity (User-Agent + client hints) |

There's no API access here: the preload bridge reads the DOM of the web player
and reports title, artist, artwork, position, duration and play state to the
main process, which fans it out to MPRIS, the tray, notifications and Discord.

## Legal

This app ships **no SoundCloud content and no credentials**. It loads
soundcloud.com in a window and you sign in with your own account, so
SoundCloud's own terms apply exactly as they do in a browser.

MIT licensed, see [`LICENSE`](LICENSE). An independent project, not affiliated
with, endorsed by or supported by SoundCloud.
