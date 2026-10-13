<p align="center">
  <img src="assets/terono-icon.png" width="112" alt="Terono">
</p>

<h1 align="center">Terono</h1>

<p align="center">A fast, fully customizable Discord look and toolkit by <b>Terona Studios</b>.<br>Windows · macOS · Linux · Browser</p>

<p align="center">
  <img src="assets/screenshots/classic.png" alt="Terono" width="100%">
</p>

## Install

| You use Discord… | Do this |
| --- | --- |
| **on Windows** | Download **[Terono-Setup.exe](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Setup.exe)** and double-click it. If Windows says *"Windows protected your PC"*: **More info → Run anyway** (the file isn't code-signed yet). Discord restarts with Terono. |
| **on macOS or Linux** | Open a terminal and run the command below. Discord restarts with Terono. |
| **in a browser** (Chrome, Brave, Edge, Opera, Firefox) | Download **[Terono-Chromium.zip](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Chromium.zip)** (Firefox: **[Terono-Firefox.zip](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Firefox.zip)**), unzip it, open your extensions page, turn on **Developer mode**, click **Load unpacked** and pick the folder. Switch off the normal Vencord extension if you have it. |
| **with just a theme** (Vencord, BetterDiscord) | See [Theme only](#theme-only) below. |

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Terona-Studios/Terono/main/install.sh | bash
```

Then open the Terono settings: **Ctrl + 1**, the Terono icon next to the ← → arrows, or **Settings → Vencord → Plugins → Terono**.

New to this? The **[step-by-step tutorial](docs/TUTORIAL.md)** walks through installing, every setting, updating and uninstalling.

<details>
<summary>What the installer does</summary>

It installs Git and Node.js if they're missing (Windows via winget, macOS via Homebrew), builds Vencord with Terono in a `Terono` folder in your home folder, adds it to Discord and turns Terono on. Your Vencord settings, themes and plugins stay. Vencord only runs extra plugins from a copy built on your own PC; the installer does that for you. The Windows installer is open source ([installer/](installer/)) and logs to `%TEMP%\Terono-Setup.log`.
</details>

## Updating

Nothing to do: Terono updates itself in the background when Discord starts and asks if you want to restart now. You can also click **Check for updates** at the top of the Terono settings. Browser: download the new zip.

## What you get

**Look**
- 12 **presets** with live preview, then change anything. **Default** is normal Discord that you can still recolor and rearrange.
- Colors: primary, text, icons, status, window buttons and an **app border** (color, gradient or your own picture).
- Cards: dark, gray, white or your own color or gradient; sharp to round corners; solid, **glass** or **liquid glass**; a picture or video inside them.
- Embeds in their own color, gradient or glass. Background: animated, static, solid, picture, GIF or video.
- 22 fonts shown in their own style, or your own font. Your own home logo and your own pictures for Discord's icons.

**Layout**
- Server list left, top, bottom or right (top and bottom scroll left to right or right to left); channels and members on either side.
- The **Terono logo as Discord's icon** on the taskbar, Start menu and shortcuts (Windows, can be turned off).
- Channel header: name, buttons and search anywhere; hide any button.
- Messages: yours on the right and others on the left, or the other way round.

**Calls** *(early alpha: expect bugs)*
- **Ambient mode:** the colors of the stream you watch glow softly around it, like on YouTube.

**Tools** *(bulk mode and the overlay are early alpha: expect bugs)*
- **Search** every setting and plugin from one box.
- **Plugins:** every Vencord plugin by category, switched on and off instantly.
- **Bulk mode:** hold Ctrl and click servers, DMs or friends, then right-click one: everything in Discord's menu is done to all of them. Double-click Home to read everything.
- **Terono overlay:** over your games: who's in your call and who's talking, DMs and mentions as they come in. A hotkey makes it clickable: mute, deafen, leave, open a message.
- **Badges:** the **Terono OG** badge for everyone on 1.0.0 – 1.1.5, up to 3 badges of your own, and Discord's badges. Seen by everyone with Terono, updated instantly.
- **Profiles:** save looks, switch between them, share them as files.
- Auto-translate, chat bar and right-click menu cleanup, role count styles, Terono loading screens.

**Reliable**
- **Terono Setup** checks that Discord opens after installing and puts plain Discord back if it doesn't; Discord also starts without Terono if Terono's files go missing. **Terono Diagnostics** repairs the rest ([see below](#discord-wont-open)).

**Light on your PC**
- Moving effects update 30 times a second instead of at your monitor's full refresh rate and stop completely while Discord is in the background. **Performance mode** for slower PCs.

## Presets

Settings → Terono → **Presets**: **Preview** tries one on your own Discord, **Apply** keeps it (with or without its layout).

| | |
| --- | --- |
| <img src="assets/screenshots/frosted.png" alt="Frosted Glass"> | <img src="assets/screenshots/paper.png" alt="Paper White"> |
| **Frosted Glass** | **Paper White** |
| <img src="assets/screenshots/crimson.png" alt="Crimson Edge"> | <img src="assets/screenshots/emerald.png" alt="Emerald"> |
| **Crimson Edge** | **Emerald** |
| <img src="assets/screenshots/sakura.png" alt="Sakura Glass"> | <img src="assets/screenshots/amber.png" alt="Amber Dock"> |
| **Sakura Glass** | **Amber Dock** |
| <img src="assets/screenshots/lagoon.png" alt="Deep Lagoon"> | <img src="assets/screenshots/mirror.png" alt="Mirror White"> |
| **Deep Lagoon** | **Mirror White** |
| <img src="assets/screenshots/violet.png" alt="Violet Focus"> | <img src="assets/screenshots/minimal.png" alt="Minimal"> |
| **Violet Focus** | **Minimal** |

The picture at the top is **Terono Classic**.

## Theme only

Just the look, without the plugin's settings and tools:

- **Vencord:** Settings → Vencord → Themes → **Online Themes**, paste this link and save:
  ```
  https://cdn.jsdelivr.net/gh/Terona-Studios/Terono@main/theme/Terono.theme.css
  ```
- **BetterDiscord:** put [Terono.theme.css](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono.theme.css) in your BetterDiscord `themes` folder.

## Discord won't open?

Download **[Terono-Diagnostics.exe](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Diagnostics.exe)** and double-click it. It tests that Discord really opens, repairs what is broken (damaged settings, missing Terono files, caches, a broken install) **without removing your account, messages or Terono settings**, and writes **Terono-Diagnostics-Report.txt** on your Desktop. If it couldn't fix everything, send that file to Terona Studios. Terono Setup also checks that Discord opens after installing and puts plain Discord back if it doesn't.

## Found a bug?

Report it on the Terona Studios Discord: **[teronastudios.com/discord](https://teronastudios.com/discord)** (also linked at the top of the Terono settings). Add **Extras → Troubleshooting → Copy debug info** and a screenshot; it shows your versions and what Terono found, so it can be fixed fast.

## Privacy

Terono only talks to these services, for the features that use them:

- **Terono badge server** (Cloudflare): the list of badges and the anonymous user count. Only your Discord user ID and what you set yourself; signing in once lets only you change your badges.
- **Terono user count:** about once a day a one-way hash of your Discord user ID, and an 'online' mark while Discord is open, so the number of Terono users can be counted. Only the creator can see the number. Turn it off with **Extras → Privacy → Count me as a Terono user** and nothing is sent.
- **Google Translate:** only with *Auto-translate* on (off by default).
- **Google Fonts:** fonts other than Discord's own.
- **GitHub / jsDelivr:** updates and preset pictures.
- **DuckDuckGo:** website icons for "domain" connections on profiles.

Your uploaded logos, fonts, backgrounds and icon pictures stay on your PC.

## Manual install (developers)

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
git clone https://github.com/Terona-Studios/Terono src/userplugins/terono
npx pnpm install --frozen-lockfile
npx pnpm build
npx pnpm inject
```

## License

[GPL-3.0](LICENSE). Third-party parts and their licenses: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).


