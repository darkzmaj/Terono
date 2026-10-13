/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies, ImageSrc } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { SETTINGS_DIR } from "@main/utils/constants";
import { execFile } from "child_process";
import { app, BrowserWindow, globalShortcut, IpcMainInvokeEvent, NativeImage, nativeImage, screen, shell } from "electron";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { TERONO_LOGO } from "./assets";
import { BADGE_API, badgesReady } from "./badgeConfig";
import { TERONO_ICON } from "./iconData";
import { OVERLAY_HTML } from "./overlayPage";
import { canUpdate, getState, latestRelease, startUpdate } from "./update";

// the badge server: its list (connect-src), uploaded badge pictures (img-src) and live updates (a wss:// connection,
// which a bare host doesn't cover)
if (badgesReady()) {
    const { host } = new URL(BADGE_API);
    CspPolicies[host] = ImageSrc;
    CspPolicies[`wss://${host}`] = ConnectSrc;
}

/* ================= in-app updater (called from the settings through VencordNative.pluginHelpers.Terono) ================= */

// the Vencord checkout this Discord runs from: dist/ (where this file is built to) sits next to src/
const ROOT = join(__dirname, "..");

export async function checkUpdate(_: IpcMainInvokeEvent) {
    const [release, updatable] = await Promise.all([latestRelease(), canUpdate(ROOT)]);
    return { ...release, canUpdate: updatable.ok, reason: updatable.reason };
}

export function beginUpdate(_: IpcMainInvokeEvent, version: string) {
    return startUpdate(ROOT, String(version));
}

export function updateState(_: IpcMainInvokeEvent) {
    return getState();
}

export function restartDiscord(_: IpcMainInvokeEvent) {
    app.relaunch();
    app.exit(0);
}

/* ================= Terono overlay =================
   Its own see-through window over games and other apps (windowed / borderless), separate from Discord's:
   - on its own it shows the call you're in (who's talking, muted, streaming) and pops up DMs and mentions,
     without taking the mouse or keyboard from the game (clicks go through it);
   - the hotkey makes it clickable: mute, deafen, leave the call, open a message in Discord. Again or Esc: back.
   It's hidden while Discord itself is in front. The page only shows what Discord sends it (overlayPage.ts). */

interface OverlayConfig { key: string; show: "on" | "hotkey" | "off"; corner: string; opacity: number; accent: string; compact: boolean; }
let ovCfg: OverlayConfig = { key: "", show: "off", corner: "top-left", opacity: 1, accent: "#429cff", compact: false };
let ov: BrowserWindow | null = null;
let ovReady = false;
let ovLive = false;
let ovKey = "";
let ovInCall = false;
let ovToastUntil = 0;
let ovToastTimer: NodeJS.Timeout | undefined;
const ovQueue: string[] = [];

function mainWindow() {
    return BrowserWindow.getAllWindows().find(w => w !== ov && !w.isDestroyed() && /discord\.com\/(app|channels)/.test(w.webContents.getURL()));
}

function ovRun(js: string) {
    if (ov && !ov.isDestroyed() && ovReady) ov.webContents.executeJavaScript(js).catch(() => { });
    else ovQueue.push(js);
}

function toDiscord(action: object) {
    mainWindow()?.webContents.executeJavaScript(`Vencord.Plugins.plugins.Terono?.overlayAction?.(${JSON.stringify(action)})`).catch(() => { });
}

function ovPlace() {
    if (!ov) return;
    const { workArea } = ovLive ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getPrimaryDisplay();
    ov.setBounds(workArea);
}

// shown: while clickable, or with something to show and Discord not in front
function ovSync() {
    if (!ov || ov.isDestroyed()) return;
    const discordFront = mainWindow()?.isFocused() ?? false;
    const content = ovCfg.show === "on" && (ovInCall || Date.now() < ovToastUntil);
    if (ovLive || (content && !discordFront)) {
        if (!ov.isVisible()) { ovPlace(); ov.showInactive(); }
        ov.setAlwaysOnTop(true, "screen-saver");
    } else if (ov.isVisible()) ov.hide();
}

function ovMessage(raw: string) {
    if (!raw?.startsWith("dz:")) return;
    let msg: any;
    try { msg = JSON.parse(raw.slice(3)); } catch { return; }
    switch (msg.a) {
        case "ready":
            ovReady = true;
            ovRun(`dz.config(${JSON.stringify(ovCfg)})`);
            for (const js of ovQueue.splice(0)) ovRun(js);
            ovSync();
            break;
        case "close":
            setLive(false);
            break;
        case "open": {
            setLive(false);
            const win = mainWindow();
            if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
            toDiscord(msg);
            break;
        }
        default:
            toDiscord(msg);
    }
}

function overlayWindow() {
    if (ov && !ov.isDestroyed()) return ov;
    ovReady = false;
    ov = new BrowserWindow({
        show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
        skipTaskbar: true, focusable: false, hasShadow: false, fullscreenable: false, backgroundColor: "#00000000", title: "Terono overlay",
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    });
    ov.setAlwaysOnTop(true, "screen-saver");
    ov.setIgnoreMouseEvents(true);
    ov.setMenu(null);
    // Electron changed this event's arguments; the text is in either place
    ov.webContents.on("console-message", (e: any, _level?: any, message?: string) => ovMessage(typeof message === "string" ? message : e?.message));
    ov.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    ov.webContents.on("will-navigate", e => e.preventDefault());
    ov.on("closed", () => { ov = null; ovReady = false; ovLive = false; });
    ovPlace();
    ov.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(OVERLAY_HTML));
    return ov;
}

function setLive(on: boolean) {
    if (!ov || ov.isDestroyed()) return;
    ovLive = on;
    ov.setIgnoreMouseEvents(!on);
    ov.setFocusable(on);
    ovRun(`dz.live(${on})`);
    if (on) { ovPlace(); ov.show(); ov.focus(); } else ov.blur();
    ovSync();
}

function toggleOverlay() {
    if (ovCfg.show === "off") return;
    overlayWindow();
    setLive(!ovLive);
}

export function overlayConfig(_: IpcMainInvokeEvent, cfg: OverlayConfig) {
    ovCfg = { ...ovCfg, ...cfg, opacity: Math.min(1, Math.max(0.4, Number(cfg.opacity) || 1)) };
    let keyOk = true;
    const key = ovCfg.show === "off" ? "" : ovCfg.key;
    if (key !== ovKey) {
        if (ovKey) globalShortcut.unregister(ovKey);
        ovKey = "";
        if (key) {
            try { keyOk = globalShortcut.register(key, toggleOverlay); } catch { keyOk = false; }
            if (keyOk) ovKey = key;
        }
    }
    if (ovCfg.show === "off") {
        ov?.destroy();
        ov = null;
        return keyOk;
    }
    overlayWindow();
    ovRun(`dz.config(${JSON.stringify(ovCfg)})`);
    ovSync();
    return keyOk;
}

export function overlayCall(_: IpcMainInvokeEvent, call: object | null) {
    ovInCall = !!call;
    if (!ov) return;
    ovRun(`dz.call(${JSON.stringify(call)})`);
    ovSync();
}

export function overlayTalk(_: IpcMainInvokeEvent, ids: string[]) {
    if (ov && ovReady && ovInCall) ovRun(`dz.talk(${JSON.stringify(ids)})`);
}

export function overlayToast(_: IpcMainInvokeEvent, toast: object) {
    if (!ov || ovCfg.show !== "on") return;
    ovRun(`dz.toast(${JSON.stringify(toast)})`);
    ovToastUntil = Date.now() + 7600;
    ovSync();
    clearTimeout(ovToastTimer);
    ovToastTimer = setTimeout(ovSync, 7700);
}

app.on("browser-window-focus", () => ovSync());
app.on("browser-window-blur", () => setTimeout(ovSync, 50));
app.on("will-quit", () => { if (ovKey) globalShortcut.unregister(ovKey); });

/* ================= updater window ================= */

// Discord's updater ("Checking for updates…") is a separate 300×300 window that Vencord doesn't load into,
// so restyle it from the main process: Terono logo + name instead of Discord's animated logo.

const HEX_RE = /^#[0-9a-f]{6}$/i;

function splashCss(accent: string, base: string) {
    return `
html, body, #splash {
    background: radial-gradient(70% 60% at 50% 38%, ${accent}38, transparent 70%), ${base} !important;
}
.splash-inner :is(video, img) {
    display: none !important;
}
.splash-inner::before {
    content: "";
    display: block;
    width: 112px;
    height: 112px;
    margin: 0 auto 14px;
    background: url("${TERONO_LOGO}") center / contain no-repeat;
}
.splash-inner .splash-text {
    top: 0 !important;
}
.splash-inner .splash-text::before {
    content: "Terono Discord";
    display: block;
    margin-bottom: 6px;
    color: #fff;
    font: 700 20px/1.3 "gg sans", sans-serif;
}
.progress .progress-bar .complete {
    background-color: ${accent} !important;
}
`;
}

/* ================= cleanup of the removed "App name & icon" option (1.0.8) =================
   1.0.8 could put your own icon and name on Discord's Windows shortcuts. That option is gone: shortcuts it changed
   are put back exactly as they were (their originals were saved), once, at the first start. */

const LINKS_FILE = join(SETTINGS_DIR, "terono-shortcuts.json");
const OLD_FILES = ["terono-app-icon.ico", "terono-app-icon.png"].map(f => join(SETTINGS_DIR, f));

interface SavedLink { dir: string; icon: string; iconIndex: number; name: string; current: string; }

function restoreShortcuts() {
    try {
        if (process.platform === "win32" && existsSync(LINKS_FILE)) {
            const saved: Record<string, SavedLink> = JSON.parse(readFileSync(LINKS_FILE, "utf8"));
            for (const link of Object.values(saved)) {
                const current = join(link.dir, link.current);
                const original = join(link.dir, link.name);
                if (!existsSync(current)) continue;
                const details = shell.readShortcutLink(current);
                shell.writeShortcutLink(current, "update", { ...details, icon: link.icon, iconIndex: link.iconIndex });
                if (current !== original) {
                    if (existsSync(original)) unlinkSync(current);
                    else renameSync(current, original);
                }
            }
            execFile("ie4uinit.exe", ["-show"], { windowsHide: true }, () => { });
        }
        for (const f of [LINKS_FILE, ...OLD_FILES]) if (existsSync(f)) rmSync(f, { force: true });
    } catch (e) {
        console.error("[Terono] restoring shortcuts", e);
    }
}

if (existsSync(LINKS_FILE) || OLD_FILES.some(existsSync)) app.whenReady().then(restoreShortcuts);

/* ================= Terono icon on the taskbar, Start menu and shortcuts (Windows) =================
   The taskbar shows a pinned program's shortcut icon and an open window's own icon, so both get the Terono logo:
   Discord's shortcuts (Start menu, Desktop, pinned on the taskbar) point at a Terono .ico, and every Discord window
   gets the logo as its icon. What the shortcuts had is saved first and put back when this is turned off.
   Discord's updater recreates its shortcuts, so it's checked again at every start. */

const TB_ICO = join(SETTINGS_DIR, "terono-taskbar.ico");
const TB_SAVED = join(SETTINGS_DIR, "terono-taskbar.json");
const DISCORD_ROOT = dirname(dirname(process.execPath));
const DISCORD_ICO = join(DISCORD_ROOT, "app.ico");
let tbOn = false;

const logoImage = () => nativeImage.createFromDataURL(TERONO_ICON);

// an .ico holding PNG images (Windows Vista and later), which shortcuts can use
function writeIco(img: NativeImage) {
    const sizes = [256, 64, 48, 32, 24, 16];
    const pngs = sizes.map(n => img.resize({ width: n, height: n, quality: "best" }).toPNG());
    const head = Buffer.alloc(6 + 16 * sizes.length);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(sizes.length, 4);
    let offset = head.length;
    sizes.forEach((n, i) => {
        const e = 6 + 16 * i;
        head.writeUInt8(n >= 256 ? 0 : n, e);
        head.writeUInt8(n >= 256 ? 0 : n, e + 1);
        head.writeUInt16LE(1, e + 4);
        head.writeUInt16LE(32, e + 6);
        head.writeUInt32LE(pngs[i].length, e + 8);
        head.writeUInt32LE(offset, e + 12);
        offset += pngs[i].length;
    });
    writeFileSync(TB_ICO, Buffer.concat([head, ...pngs]));
}

function shortcutDirs() {
    const roaming = app.getPath("appData");
    return [
        join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "Discord Inc"),
        join(roaming, "Microsoft", "Windows", "Start Menu", "Programs"),
        app.getPath("desktop"),
        join(roaming, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
    ];
}

// only this Discord's own shortcuts: its Update.exe (started with Discord.exe) or its Discord.exe
const isThisDiscord = (target: string) => target.toLowerCase().startsWith(DISCORD_ROOT.toLowerCase() + "\\");

function brandShortcuts(on: boolean) {
    try {
        const saved: Record<string, { icon: string; iconIndex: number; }> = existsSync(TB_SAVED) ? JSON.parse(readFileSync(TB_SAVED, "utf8")) : {};
        if (on) writeIco(logoImage());
        let changed = false;

        for (const dir of shortcutDirs()) {
            if (!existsSync(dir)) continue;
            for (const file of readdirSync(dir)) {
                if (!file.toLowerCase().endsWith(".lnk")) continue;
                const path = join(dir, file);
                let link: Electron.ShortcutDetails;
                try { link = shell.readShortcutLink(path); } catch { continue; }
                if (!isThisDiscord(link.target)) continue;
                if (/Update\.exe$/i.test(link.target) && !/Discord\.exe/i.test(link.args ?? "")) continue;

                const cur = link.icon ?? "";
                const ours = cur.toLowerCase() === TB_ICO.toLowerCase();
                if (on && !ours) saved[path] = { icon: cur, iconIndex: link.iconIndex ?? 0 };

                const want = on ? { icon: TB_ICO, iconIndex: 0 } : saved[path];
                if (!want || (cur === want.icon && (link.iconIndex ?? 0) === want.iconIndex)) continue;
                shell.writeShortcutLink(path, "update", { ...link, icon: want.icon, iconIndex: want.iconIndex });
                changed = true;
            }
        }

        if (on) writeFileSync(TB_SAVED, JSON.stringify(saved));
        else for (const f of [TB_SAVED, TB_ICO]) rmSync(f, { force: true });

        // Explorer caches icons: ask it to refresh
        if (changed) execFile("ie4uinit.exe", ["-show"], { windowsHide: true }, () => { });
    } catch (e) {
        console.error("[Terono] taskbar icon", e);
    }
}

function windowIcon(win: BrowserWindow) {
    if (win.isDestroyed() || win === ov) return;
    const original = existsSync(DISCORD_ICO) ? nativeImage.createFromPath(DISCORD_ICO) : null;
    if (tbOn) win.setIcon(logoImage());
    else if (original && !original.isEmpty()) win.setIcon(original);
}

export function setTaskbarIcon(_: IpcMainInvokeEvent, on: boolean) {
    tbOn = !!on;
    if (process.platform !== "win32") return;
    BrowserWindow.getAllWindows().forEach(windowIcon);
    brandShortcuts(tbOn);
}

// at start: on unless turned off (and nothing is touched when Terono is off and there's nothing to put back)
{
    const s = RendererSettings.store.plugins?.Terono;
    tbOn = process.platform === "win32" && !!s?.enabled && s.taskbarIcon !== false;
    if (process.platform === "win32" && (tbOn || existsSync(TB_SAVED))) app.whenReady().then(() => brandShortcuts(tbOn));
}

app.on("browser-window-created", (_, win) => {
    if (tbOn) windowIcon(win);
    win.webContents.on("dom-ready", () => {
        if (!/[\\/]splash[\\/]index\.html/i.test(win.webContents.getURL())) return;

        const s = RendererSettings.store.plugins?.Terono;
        if (!s?.enabled || s.loadingScreen === false) return;

        const accent = HEX_RE.test(s.accent) ? s.accent : "#429cff";
        const base = HEX_RE.test(s.bgBase) ? s.bgBase : "#000000";
        win.webContents.insertCSS(splashCss(accent, base)).catch(() => { });
    });
});
