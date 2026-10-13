# Terono tutorial

Everything from installing to building your own look, step by step.

- [1. Which install is for me?](#1-which-install-is-for-me)
- [2. Install on the Discord app (Windows, macOS, Linux)](#2-install-on-the-discord-app)
- [3. Install in your browser (Chrome, Brave, Edge, Opera, Firefox)](#3-install-in-your-browser)
- [4. Open the Terono settings](#4-open-the-terono-settings)
- [5. Make it yours](#5-make-it-yours)
- [6. Save looks as profiles](#6-save-looks-as-profiles)
- [7. Extra features](#7-extra-features)
- [8. Updating](#8-updating)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Uninstalling](#10-uninstalling)

---

## 1. Which install is for me?

| You use Discord in... | Do this |
| --- | --- |
| The Discord app on **Windows** | [Terono-Setup.exe](#windows) |
| The Discord app on **macOS / Linux** | [One command](#macos--linux) |
| **Chrome, Brave, Edge, Opera, Vivaldi** | [Browser extension](#chrome-brave-edge-opera-vivaldi) |
| **Firefox** | [Firefox add-on](#firefox) |
| Only want the look, no settings | [Theme only](#theme-only) |

---

## 2. Install on the Discord app

### Windows

1. Download **[Terono-Setup.exe](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Setup.exe)**.
2. Double-click it. The file isn't code-signed yet, so Windows may say *"Windows protected your PC"*: click **More info → Run anyway**.
3. Wait for the green *Terono is installed* line. The first run takes a few minutes because it downloads Git and Node.js if you don't have them.
4. Discord closes and opens again with Terono on.

To check the file: right-click it → **Properties → Details** shows *Terono Setup* by *Terona Studios*. If something goes wrong, the steps it took are in `%TEMP%\Terono-Setup.log`.

### macOS / Linux

Open **Terminal** and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/Terona-Studios/Terono/main/install.sh | bash
```

On macOS, [Homebrew](https://brew.sh) installs Git and Node.js if they're missing. On Linux, install `git` and `nodejs` with your package manager first (for example `sudo apt install git nodejs npm`).

> **Why an installer?** Vencord only runs extra plugins from a copy built on your own PC. The installer builds that copy in a `Terono` folder in your home folder and puts it into Discord. Your other Vencord plugins, themes and settings stay as they are.

---

## 3. Install in your browser

Works on `discord.com/app`. Everything the app version has is included, except the window buttons (the browser has its own).

### Chrome, Brave, Edge, Opera, Vivaldi

1. Download **[Terono-Chromium.zip](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Chromium.zip)** and unzip it (right-click → **Extract All**). Put the folder somewhere you'll keep it, for example in Documents. The browser loads it from there.
2. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
   - Opera: `opera://extensions`
3. Turn on **Developer mode** (top right; on Edge it's on the left).
4. If you already have the normal **Vencord** extension, switch it **off**. Terono's extension already contains Vencord, and two copies would load twice.
5. Click **Load unpacked** and pick the unzipped folder, the one that contains `manifest.json`.
6. Open or refresh [discord.com/app](https://discord.com/app).

Terono turns itself on and adds its theme on the first start. There's nothing else to set up.

### Firefox

Firefox only keeps extensions signed by Mozilla, so this one loads until you close Firefox:

1. Download **[Terono-Firefox.zip](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Firefox.zip)** (don't unzip it).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the zip.
4. Refresh [discord.com/app](https://discord.com/app).

To keep it permanently, use **Firefox Developer Edition** or **Nightly**: set `xpinstall.signatures.required` to `false` in `about:config`, then install the zip from `about:addons` → ⚙ → **Install Add-on From File…**

### Theme only

If you already use Vencord (app or browser) and only want the look:

1. **Settings → Vencord → Themes → Online Themes**
2. Paste and save:

```
https://cdn.jsdelivr.net/gh/Terona-Studios/Terono@main/theme/Terono.theme.css
```

The theme alone uses the default Terono look: blue, dark cards, top server list. All the options below need the plugin.

**BetterDiscord:** put [Terono.theme.css](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono.theme.css) in your BetterDiscord `themes` folder.

---

## 4. Open the Terono settings

Either:

- press **Ctrl + 1**, or
- click the **Terono icon** next to the ← → arrows at the top left, or
- **User Settings** (⚙ next to your name) → **Vencord** → **Plugins** → search **Terono** → ⚙.

At the top is the **Updates** box and a small **search box**: type anything ("border", "font", "translate", a plugin's name) to find every setting and plugin that matches, wherever it is. Below it are the tabs: **Presets, Colors, Cards, Background, Layout, Header, Chat & Members, Font, Logo & Icons, Calls, Overlay, Menus, Extras, Badges, Profiles, Plugins**. Every change shows up straight away; there's nothing to save or restart.

**Shortcut:** press **Ctrl + 1** anywhere in Discord to open the Terono settings. Turn it off under **Extras → Shortcut**.

---

## 5. Make it yours

### Presets: a whole look in one click

The **Presets** tab has 12 complete looks: **Default** (normal Discord: panels joined like Discord, its colors, font and layout, and still everything changeable) and the ones in the pictures in the [README](../README.md): Terono Classic, Frosted Glass, Paper White, Crimson Edge, Emerald, Sakura Glass, Amber Dock, Deep Lagoon, Mirror White, Violet Focus and Minimal.

1. Not sure? Click **Preview**. The settings close and the preset is shown on your actual Discord. The bar at the bottom lets you:
   - flip through the presets with **‹** and **›**,
   - tick **Include layout** to see the preset's layout too,
   - click **Keep** to use it, or **Go back** to return to exactly what you had.
2. Or click **Apply** and choose:
   - **Theme + layout:** colors, cards (color, corners, glass), background and font, plus the preset's layout (server list position and order, channel and member list sides, header), exactly like its picture.
   - **Only the theme:** colors, cards (color, corners, glass), background and font; your layout stays as it is.
3. Change anything you like in the other tabs. The preset gets a **Customized** tag, and **Re-apply** brings the original back.

Your logo, menus, chat bar buttons, translate and performance settings are never touched by a preset. To keep your current look, save it under **Profiles** before applying one.

### Colors

- **Color preset:** Blue, Red, Purple, Green, Pink or Orange, or use the **Primary color** picker under it for any color. It's used for buttons, links, mentions, selection and glow.
- **Text:** turn on **Custom text color** and pick any **Text color**. Muted text (descriptions, timestamps) is made from it automatically.
- **Icons:** turn on **Custom icon color** and pick an **Icon color** for every icon: back/forward arrows, the header buttons (call, pins, add friend, search), channel icons, the server list buttons, the chat bar, the buttons next to your name and settings. Icons on colored buttons stay white, and server folders keep their own color. Hovered and selected icons get a bit brighter. Off, icons follow the text color.
- **Status & window buttons:** the **Voice & online** color and the **Close**, **Minimize** and **Maximize** button colors.
- **App border:** a frame around the whole window: **None**, **Color**, **Gradient** (two colors) or **Picture (file)**: pick any image from your PC; with its **Width**.

### Cards (the panels)

- **Card colors:** **Dark**, **Gray**, **White** or **Custom**. Custom adds **Fill** (**Solid color** or **Gradient**, with **Gradient end** and **Gradient angle**) and **Card color**. The text color is under **Colors → Text**.
- **Shape & material:**
  - **Corners:** **Sharp**, **Soft**, **Curved** or **Round**.
  - **Material:** **Solid**, **Glass** or **Liquid glass**. Glass is see-through; set it with **Glass opacity** and turn **Glass blur** on or off. Liquid glass is see-through panels with soft light slowly flowing under them: pick the **Light color** (your colors, or white for clear glass) and the **Flow speed** (**Still** turns the motion off completely). With **Glass blur** on, the light is blurred too. Performance mode keeps the light still. Menus, popups and buttons always stay solid so they stay readable.
- **Embeds (link previews):** **Like the cards**, **One color**, **Gradient** (with **Gradient end** and **Gradient angle**) or **Glass** (with **Glass opacity**). With one color or a gradient, the embed text turns dark or light by itself so it stays readable.
- **Picture or video in the cards:** an image, GIF or video inside the panels, separate from the background.
  - Choose **URL** and paste a direct link in **Link**, or **File** and upload one (up to 100 MB).
  - It runs across all panels as one picture; the gaps between the panels keep the background.
  - **Card color over it** sets how much of the card color lies on top. Higher is easier to read.

### Background (behind the panels)

- **Background:** **Animated gradient** (default), **Static gradient**, **Solid color**, or **Image / GIF / Video**.
- **Picture, GIF or video:** choose **URL** and paste a direct `https://` link, or **File** and upload one (up to 100 MB). **Darken** keeps text readable. GIFs and videos use the most power; see [Performance](#performance).
- **Colors:** **Base color** (the whole background when Solid) and **Glow color 1 / 2** for the gradients.

### Layout

| Setting | Options |
| --- | --- |
| **Server list** | Left (Discord default), Top, Bottom, Right |
| **Server order** (Top and Bottom only) | Left to right, Right to left (both scroll with the mouse wheel; fixed in 1.1.0) |
| **Channel list side** | Left, Right |
| **Member list side** | Right, Left |

You can combine them freely. For example, Server list **Right** + Channel list side **Right** + Member list side **Left** mirrors the whole app.

### Header (the bar above the chat)

- **In servers:** **Channel name** (Left, Middle, Right or Hidden), **# icon**, **Buttons** (pins, threads, notifications…) and **Search bar**, each Left, Middle or Right, plus the **Follow button** in announcement channels.
- **In DMs:** **Name & avatar**, **Buttons** and **Search bar**, set separately from servers.
- **Hidden buttons:** type words from button names, comma separated (e.g. `Threads, Inbox`), and matching buttons disappear.

### Chat & Members

- **Messages:** **Mine on the right, others on the left** (like a phone), the other way round, or **Off** (Discord's normal list). Works in DMs and servers.
- **Chat bar buttons:** turn **Translate**, **GIF**, **Emoji**, **Sticker**, **Gift**, **Apps** and **Other plugins' buttons** on or off.
- **Member list:** **Role count** as `Role (1)`, `Role · 1`, `Role [1]`, `Role 1`, `Role — 1`, no count, or **Custom**. With Custom, write your own text in **Custom role count**; `%users%` is replaced with the number (e.g. `• %users% online`).
- **Activities:** turn off **Show activities** to hide *Start an Activity* everywhere: voice panel, call buttons and call grid.

### Font & Logo

- **Font:** click one of the 22 fonts (each name is written in its own font), or **Custom (upload)** to use your own `.ttf`, `.otf`, `.woff` or `.woff2` file.
- **Home logo:** the Terono logo sits on the Home button by default. Set **Logo source** to **URL** and paste a **Logo link**, or to **File** and upload an image. **Logo size** makes it bigger or smaller; an empty link brings the Terono logo back.
- **Quick settings icon:** the Terono icon next to the arrows that opens these settings.
- **Terono loading screens:** the Terono logo and "Terono Discord" instead of Discord's logo while Discord starts, updates and connects, in your colors. The small update window ("Checking for updates…") changes from the next start.

---

## 6. Save looks as profiles

In the **Profiles** tab:

1. Set everything up the way you like.
2. Type a name, choose which parts to include (everything, or only some sections like colors or layout), and click **Save current**.
3. Click **Apply** on a profile to switch to it in one go.
4. **Export** saves a profile as a file you can share. **Import JSON** loads one someone sent you.
5. **Reset to defaults** puts every Terono setting back to the defaults. Your saved profiles are kept.

---

## 7. Extra features

- **Menus tab:** hide right-click menu items by typing their exact names, comma separated: **In every menu**, **In the server menu** and **In user & DM menus**.
- **Extras → Translate:** **Auto-translate** (off by default) translates messages you receive into English, using Vencord's Translate plugin (keep that plugin on). Add language codes to **Never translate** for languages you read yourself. Message text is sent to Google Translate while this is on.
- **Extras → Updates:** **Update automatically** (on by default): when Discord starts, and every few hours, a new Terono installs itself in the background and a notification offers a restart. With it off, **Notify about new versions** just tells you.
- **Extras → Taskbar:** **Terono icon on the taskbar** (on by default, Windows): Discord's icon on the taskbar, Start menu and desktop shortcuts becomes the Terono logo. Turn it off to get Discord's own icon back.
- **Extras → Privacy:** **Count me as a Terono user** (on by default) lets Terono be counted anonymously (see Privacy in the README). Turn it off and nothing is sent.
- **Extras → Shortcuts:**
  - **Bulk select with Ctrl:** hold **Ctrl** and click servers, DMs or friends to select several (they get a colored outline). Then **right-click any of them**: it's Discord's normal menu with *For all N servers* on top, and whatever you pick (mark as read, mute for a time, notification settings, hide muted channels, leave, close DM, remove friend, block, …) is done to all of them. Leaving, removing and blocking ask once for all. **Esc** clears the selection.
  - **Double-click Home: read all** marks every server and DM as read.
- **Overlay tab (Terono overlay):** a see-through panel over your games and other apps (windowed or borderless; desktop app only). It shows the call you're in with who's talking, muted or streaming, and pops up DMs and messages that mention you. Clicks go through it to your game, and it hides while Discord itself is in front. Press the **Hotkey** (Ctrl + Shift + O by default) to make it clickable: **Mute**, **Deafen**, **Open** (Discord at that call) and **Leave**, or click a message to open it in Discord. Press the hotkey again or **Esc** to go back to your game. Pick its **Corner**, **Only who's talking**, **Messages** on or off and **Opacity**; **Only when I press the hotkey** keeps it hidden until you call it up.
- **Plugins tab:** every Vencord plugin in one list, sorted into categories (Chat & messages, Images, GIFs & video, Voice & calls, People & profiles, Servers & roles, and more). Find one with the search box at the top of the settings, or pick a category, **Recommended** (the ones that go best with Terono) or **On**. Switches react straight away, and ⚙ opens a plugin's settings. Plugins that change Discord's own code need a restart: they get a **Restart to apply** tag and are listed in the Updates box at the top, with a **Restart Discord** button.

### Calls

> **Early alpha:** ambient mode, bulk mode and the Terono overlay are brand new and can be buggy. Found something? Report it with **Copy debug info** (see [Troubleshooting](#9-troubleshooting)).

In the **Calls** tab:

- **Ambient mode:** while you watch a stream, its colors glow softly around it, like on YouTube, following the picture live. Everything else in calls is Discord's own.

### Your own icons

Under **Font, Logo & Icons → Your own pictures for Discord's buttons**: click **Change** under Friends, Shop, Nitro, Add a Server, Discover, Microphone, Headphones, User settings, Inbox, Help, Pinned messages or Member list and pick any picture. **Reset** brings the normal icon back. For any other button, type its name as shown when you hover it (e.g. `Start Video Call`) and click **Choose picture**.

### Badges

In the **Badges** tab:

- **Terono OG:** everyone who uses Terono between 1.0.0 and 1.1.5 gets this badge automatically, and keeps it.
- **Connect with Discord** once: Discord asks you to **Authorize**. Terono only gets your user ID. This makes sure only you can change your badges.
- **Custom badges:** up to 3. Click **+** to choose any image; it's made 64×64 and still (a GIF keeps its first frame). Give it a name (shown when someone hovers it), optionally a **Glow** or **Outline** in any color, and click **Save**.
- **Discord badges:** click the ones you want to wear (Nitro, Server Booster, HypeSquad, Early Supporter and more), then **Save Discord badges**. Staff, Partner and Moderator badges aren't available.

Everyone who uses Terono sees your changes right away (open profiles update the next time they're opened). People without Terono don't see them at all.

### Performance

Terono's moving effects (animated background, liquid glass) update 30 times a second, which looks the same for such slow motion but is far lighter than your monitor's full refresh rate. While Discord isn't the active window, e.g. while you play, they stop completely (**Extras → Pause when Discord isn't in front**, on by default).

On a slow PC or a laptop on battery, turn on **Performance mode** (Extras tab). It stops the background animation, blur, pulsing badges and hover animations. If you want to keep your look, these help most:

- **Background** set to **Static gradient** or **Solid color**, instead of Animated or a GIF/video.
- **Material** set to **Solid**, or Glass with **Glass blur** off.

---

## 8. Updating

- **Discord app, inside Discord:** open the Terono settings. The **Updates** box at the top shows your version; click **Check for updates**. If a new version is out, you see what's new and an **Update** button. The update screen downloads and builds it (you can hide it and keep chatting), then click **Restart Discord**. By default Terono also updates itself when Discord starts and every few hours, and shows a notification with a restart button when it's ready. Turn that off with **Update automatically** (Extras tab).
- **Discord app, with the installer:** run **Terono-Setup.exe** again (macOS / Linux: the install command). It downloads the newest Terono and Vencord and rebuilds. If the download folder got damaged, it downloads it fresh by itself.
- **Browser:**
  1. Download the newest zip from [Releases](https://github.com/Terona-Studios/Terono/releases/latest).
  2. Replace the files in your folder.
  3. Click **↻ reload** on the extension card and refresh Discord.
- **Theme only:** updates by itself.

---

## 9. Troubleshooting

**Found a bug?** Report it on the Terona Studios Discord: **[teronastudios.com/discord](https://teronastudios.com/discord)**. The link is also at the top of the Terono settings. Go to **Extras → Troubleshooting → Copy debug info** and paste it with a screenshot. It lists your Terono, Vencord and Discord versions and what Terono found on your screen (no messages or account details).

**It works for my friend but not for me (or the other way round).**
Check the version at the top of the Terono settings: you might be on an older Terono. Click **Check for updates**. If there's no update button, or it says the install can't update itself, download and run **[Terono-Setup.exe](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Setup.exe)** once. It updates everything and keeps your settings. Browser versions don't update themselves: download the newest zip.

**My antivirus flagged `Install-Terono.cmd`.**
That was the old installer. It downloaded and ran a PowerShell script in one go, which Windows Defender treats as suspicious (`Trojan:Win32/Commando.A!ml`), even though the script itself was harmless. Delete it and use **[Terono-Setup.exe](https://github.com/Terona-Studios/Terono/releases/latest/download/Terono-Setup.exe)** instead. It updates the same install, so your settings are kept.

**Terono disappeared after a Discord update (app).**
Discord's big updates sometimes remove Vencord. Run the installer again; your settings are kept.

**The look is there but the Terono settings aren't (or the other way round).**

- *Settings are there, look is missing:* check that the theme link is in **Settings → Vencord → Themes → Online Themes**, and that its switch is on.
- *Look is there, settings are missing:* you have the theme only. Install the app or browser version.

**Everything shows up twice / looks broken in the browser.**
You have both the normal Vencord extension and the Terono one turned on. Switch the normal Vencord extension off.

**My background or logo link doesn't show.**
Vencord only loads images from sites it allows, for example Discord's CDN, Imgur, GitHub and Tenor. Upload the file instead (**File** as the source), or use a link from one of those sites.

**Something looks off after a Discord update.**
Discord sometimes renames its internal parts. Update Terono (step 8); if it's still off, [open an issue](https://github.com/Terona-Studios/Terono/issues) with a screenshot.

**Hiding header buttons or menu items by name doesn't work.**
Those match Discord's English names. Set Discord to English, or type the names exactly as your language shows them.

---

## 10. Uninstalling

- **Discord app, Windows:** run in PowerShell:

  ```powershell
  cd ~\Terono\Vencord; node scripts/runInstaller.mjs -- --uninstall
  ```

  Then delete the `Terono` folder in your home folder.
- **Discord app, macOS / Linux:** run:

  ```bash
  cd ~/Terono/Vencord && node scripts/runInstaller.mjs -- --uninstall
  ```

  Then delete `~/Terono`.
- **Browser:** remove the extension on the extensions page. If you had the normal Vencord extension, switch it back on.
- **Theme only:** remove the link in **Online Themes**.



