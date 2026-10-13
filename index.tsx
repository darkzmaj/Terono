/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import { addGlobalContextMenuPatch, GlobalContextMenuPatchCallback, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { plugins } from "@api/PluginManager";
import { Settings, SettingsStore, useSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { GoogleLanguages } from "@plugins/translate/languages";
import { handleTranslate } from "@plugins/translate/TranslationAccessory";
import type { TranslationValue } from "@plugins/translate/utils";
import definePlugin, { PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, SelectedChannelStore, useEffect, UserStore } from "@webpack/common";

import { CREATOR_BADGE, VROCA_BADGE } from "./assets";
import { startBadges, stopBadges } from "./badges";
import { startBranding, stopBranding } from "./branding";
import { BULK_CSS, startBulk, stopBulk } from "./bulk";
import { CALL_CSS, startCall, stopCall } from "./call";
import { recordError, safely } from "./diagnostics";
import { attachHeader, detachHeader, onHeaderClick } from "./header";
import { setPauseWhenUnfocused, startMotion, stopMotion } from "./motion";
import { overlayAction, stopOverlay } from "./overlay";
import { applyPreset, PRESETS } from "./presets";
import { cancelPreview, PREVIEW_CSS, restoreUnfinishedPreview } from "./preview";
import { ACCENTS, applyAll, applyDarkerPalette, CARDS, DEFAULT_LOGO, forgetOverlay, loadStoredFiles, loadUploadedLogo, removeAll, settings } from "./settings";
import { SHAPES_CSS, startShapes, stopShapes } from "./shapes";
import themeStyle from "./theme/Terono.theme.css?managed";
import { announceUpdated, startAutoCheck, stopAutoCheck } from "./updater";
import { applyUsage, startUsage, stopUsage } from "./usage";
import { VERSION } from "./version";

/* ================= quick settings icon + header popouts =================
   The icon is a CSS ::after on the back/forward group (survives every re-render); a click on the
   group itself, right of the last arrow, can only be that icon. */

// Ctrl + 1 opens the Terono settings (can be turned off under Extras)
function onKeyDown(e: KeyboardEvent) {
    if (!settings.store.openKeybind || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.repeat) return;
    if (e.code !== "Digit1" && e.code !== "Numpad1") return;
    e.preventDefault();
    e.stopPropagation();
    if (!document.querySelector(".dz-set")) openPluginModal(plugins.Terono);
}

function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.classList?.contains("backForwardButtons__63abb")) {
        const last = t.lastElementChild?.getBoundingClientRect();
        if (settings.store.quickIcon && (!last || e.clientX > last.right)) openPluginModal(plugins.Terono);
        return;
    }
    onHeaderClick(e);
}

/* ================= DM vs server (header layouts differ) ================= */

function syncChannelKind(channelId?: string | null) {
    const ch = channelId ? ChannelStore.getChannel(channelId) : null;
    const d = document.documentElement.dataset;
    if (ch && !ch.guild_id) d.dzDm = "";
    else delete d.dzDm;
    requestAnimationFrame(() => requestAnimationFrame(attachHeader));
}

/* ================= profile connections: dark-theme logos, favicons for custom domains ================= */

const faviconFallback = new Map<string, string>();

function isLightCard() {
    const s = settings.store;
    const text = s.cardPreset === "custom" ? s.textColor : CARDS[s.cardPreset]?.text ?? "#ffffff";
    const n = parseInt(text.slice(1), 16);
    return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 128;
}

function connectionIcon(platform: any, account: any) {
    const icon = platform?.icon;
    if (!icon) return undefined;
    const themed = isLightCard() ? icon.lightPNG : icon.darkPNG ?? icon.lightPNG;
    if (account?.type !== "domain" || typeof account.name !== "string" || !/^[a-z0-9.-]{1,253}$/i.test(account.name)) return themed;

    // DuckDuckGo's favicon API is on Vencord's default allow-list, so every user of the plugin can load it
    const url = `https://icons.duckduckgo.com/ip3/${account.name.toLowerCase()}.ico`;
    faviconFallback.set(url, themed);
    return url;
}

// DuckDuckGo answers unknown domains with a 48x48 placeholder; show Discord's own icon instead
function connectionIconLoaded(e: { currentTarget: HTMLImageElement; type: string; }) {
    const img = e.currentTarget;
    const fallback = faviconFallback.get(img.src);
    if (fallback && (e.type === "error" || (img.naturalWidth === 48 && img.naturalHeight === 48))) img.src = fallback;
}

/* ================= context menus ================= */

const labelSet = (list: string) => new Set(list.split(",").map(x => x.trim().toLowerCase()).filter(Boolean));

function prune(children: any[], hide: Set<string>) {
    for (let i = children.length - 1; i >= 0; i--) {
        const c = children[i];
        if (!c) continue;
        if (Array.isArray(c)) { prune(c, hide); continue; }

        const { label } = c.props ?? {};
        if (typeof label === "string" && hide.has(label.toLowerCase())) {
            children.splice(i, 1);
            continue;
        }

        const sub = c.props?.children;
        if (Array.isArray(sub)) prune(sub, hide);
        else if (typeof sub?.props?.label === "string" && hide.has(sub.props.label.toLowerCase())) c.props.children = null;
    }
}

// global patches run after every per-menu patch, so items added by other plugins are caught too
const menuPatch: GlobalContextMenuPatchCallback = (navId, children) => {
    const s = settings.store;
    const scoped = navId === "guild-context" ? s.hiddenServerMenu
        : navId === "user-context" || navId === "gdm-context" ? s.hiddenUserMenu
            : "";
    const hide = labelSet(`${s.hiddenMenuItems},${scoped}`);
    if (hide.size) prune(children, hide);
};

/* ================= auto translate ================= */

const translated = new Map<string, TranslationValue | null>();
let queue: Promise<unknown> = Promise.resolve();

async function detectAndTranslate(text: string): Promise<TranslationValue | null> {
    // same public endpoint the Translate plugin uses
    const res = await fetch("https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
        "params.client": "gtx",
        "dataTypes": "TRANSLATION",
        "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA",
        "query.sourceLanguage": "auto",
        "query.targetLanguage": "en",
        "query.text": text,
    }));
    if (!res.ok) return null;

    const { sourceLanguage, translation }: { sourceLanguage?: string; translation?: string; } = await res.json();
    if (!sourceLanguage || labelSet(settings.store.keepLanguages).has(sourceLanguage.toLowerCase().split("-")[0])) return null;
    if (!translation || translation.trim().toLowerCase() === text.trim().toLowerCase()) return null;

    return { sourceLanguage: GoogleLanguages[sourceLanguage] ?? sourceLanguage, text: translation };
}

function show(id: string, value: TranslationValue) {
    try {
        handleTranslate(id, value);
    } catch {
        // Translate plugin disabled, or the message scrolled away
    }
}

function AutoTranslate({ message }: { message: Message; }) {
    useEffect(() => {
        if (!settings.store.autoTranslate || !message.content) return;
        if (message.author?.id === UserStore.getCurrentUser()?.id) return;

        const words = message.content.replace(/<[^>]+>|https?:\/\/\S+|:\w+:/g, "");
        if (!/\p{L}{2,}/u.test(words)) return;

        if (translated.has(message.id)) {
            const cached = translated.get(message.id);
            if (cached) show(message.id, cached);
            return;
        }

        let alive = true;
        // one request at a time so opening a busy channel doesn't hit Google's rate limit
        queue = queue.then(async () => {
            if (!alive) return;
            const result = await detectAndTranslate(message.content).catch(() => null);
            translated.set(message.id, result);
            if (result && alive) show(message.id, result);
        });
        return () => { alive = false; };
    }, [message.id]);

    return null;
}

/* ================= member list role header count ================= */

const ROLE_COUNT: Record<string, (n: string) => string> = {
    paren: n => `(${n})`,
    dot: n => `· ${n}`,
    bracket: n => `[${n}]`,
    space: n => n,
    dash: n => `— ${n}`,
};

// one fixed list: every role header in the member list listens to just these two settings
const ROLE_COUNT_PATHS = ["plugins.Terono.roleCount", "plugins.Terono.roleCountCustom"] as any[];

function RoleCount({ count }: { count: string; }) {
    useSettings(ROLE_COUNT_PATHS);
    const { roleCount, roleCountCustom } = settings.store;
    const text = roleCount === "custom"
        ? (roleCountCustom.includes("%users%") ? roleCountCustom.replaceAll("%users%", count) : "")
        : ROLE_COUNT[roleCount]?.(count) ?? "";
    return text ? <span className="dz-role-count">{text}</span> : null;
}

/* ================= creator badge ================= */

const CREATOR_ID = "1364930123656335402";

const creatorBadge: ProfileBadge = {
    id: "terono-creator",
    description: "Creator of Terono",
    iconSrc: CREATOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => userId === CREATOR_ID,
    props: { "data-dz-creator": "" } as ProfileBadge["props"],
};

const VROCA_ID = "899345095982194688";

const vrocaBadge: ProfileBadge = {
    id: "terono-vroca",
    description: "Vroca Macka",
    iconSrc: VROCA_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => userId === VROCA_ID,
    props: { "data-dz-vroca": "" } as ProfileBadge["props"],
};

// the glow ships with the plugin, so it works without waiting for the theme file to update
const BADGE_CSS = `
[data-dz-vroca] {
    border-radius: 50%;
    animation: dz-vroca-glow 2.4s ease-in-out infinite;
}
@keyframes dz-vroca-glow {
    0%, 100% { filter: drop-shadow(0 0 2px rgb(168 85 247 / 70%)); }
    50% { filter: drop-shadow(0 0 6px rgb(168 85 247 / 100%)) drop-shadow(0 0 3px rgb(217 70 239 / 85%)); }
}
html[data-dz-lite] [data-dz-vroca] {
    animation: none;
    filter: drop-shadow(0 0 3px rgb(168 85 247 / 90%));
}`;

let badgeStyle: HTMLStyleElement | null = null;

// the Terono logo as Discord's icon on the taskbar, Start menu and shortcuts (the main process does it, desktop only)
function setTaskbarIcon(on: boolean) {
    if (!IS_DISCORD_DESKTOP) return;
    (VencordNative.pluginHelpers.Terono as PluginNative<typeof import("./native")>).setTaskbarIcon(on).catch(() => { });
}

/* ================= live settings =================
   This Vencord build never calls a setting's onChange, so listen to the store and re-apply.
   Every apply step skips work when its output is unchanged, so this stays cheap. */

let pendingApply = 0;
function onSettingsChange(value: unknown, path: string) {
    if (path === "plugins.Terono.accentPreset" && typeof value === "string" && ACCENTS[value]) settings.store.accent = ACCENTS[value];
    if (path === "plugins.Terono.shareUsage") applyUsage();
    if (path === "plugins.Terono.taskbarIcon") setTaskbarIcon(value !== false);
    if (!path.startsWith("plugins.Terono.") || pendingApply) return;
    pendingApply = requestAnimationFrame(() => {
        pendingApply = 0;
        safely("apply", applyAll);
    });
}

/* ================= migration from earlier versions ================= */

// The theme is loaded from the release tag that matches this plugin, not from @main: jsDelivr caches @main for up
// to 12 hours, so theme fixes reached people late and the theme could be newer or older than the plugin.
// The tag is v + VERSION (version.ts), bumped together with each release.
const THEME_VERSION = `v${VERSION}`;
const THEME_LINK = `https://cdn.jsdelivr.net/gh/Terona-Studios/Terono@${THEME_VERSION}/theme/Terono.theme.css`;
const THEME_LINK_RE = /^https:\/\/cdn\.jsdelivr\.net\/gh\/Terona-Studios\/Terono@[\w.-]+\/theme\/Terono\.theme\.css$/;

async function migrate() {
    const raw = Settings.plugins.Terono as Record<string, any>;
    if (raw.dzVersion === 11) return;
    if (raw.dzVersion !== 10 && raw.dzVersion !== 9 && raw.dzVersion !== 7 && raw.dzVersion !== 8 && raw.dzVersion !== 6) await migrateLegacy(raw);

    // 1.0.4: the text color got its own switch (before, only custom card colors used it)
    if (raw.cardPreset === "custom" && raw.customText === undefined) raw.customText = true;
    // 1.0.8.1: the app name / icon option is gone
    delete raw.appName;
    delete raw.appIcon;
    // 1.0.9: the call look and minimized stream options are gone (Discord's own again)
    for (const k of ["callLook", "callCircles", "callWave", "callLiveRing", "callLayout", "callSide", "pipShape", "pipX", "pipY"]) delete raw[k];
    // 1.1.1: AFK mode is gone
    for (const k of ["afkMode", "afkStatus", "afkLastText"]) delete raw[k];
    raw.dzVersion = 11;
}

/* ================= the theme, built in =================
   The plugin carries its own copy of the theme and turns it on itself: no download, so it's there on the first
   frame, works offline and where jsDelivr is blocked, and always matches this version. Colors and most options only
   work through the theme, so a missing or outdated theme link was why they did nothing on some PCs.
   The online theme link would load it a second time, so it's taken out while the plugin runs and put back when
   the plugin is turned off (the theme then keeps working on its own). */

const LOCAL_THEME = /^(terono|darkness)\.theme\.css$/i;

function useBuiltInTheme() {
    enableStyle(themeStyle);
    if (Settings.themeLinks.some(l => THEME_LINK_RE.test(l)))
        Settings.themeLinks = Settings.themeLinks.filter(l => !THEME_LINK_RE.test(l));
    // an old local copy from earlier setups would load it twice too
    if (Settings.enabledThemes.some(t => LOCAL_THEME.test(t)))
        Settings.enabledThemes = Settings.enabledThemes.filter(t => !LOCAL_THEME.test(t));
}

function leaveThemeLink() {
    disableStyle(themeStyle);
    if (!Settings.themeLinks.some(l => THEME_LINK_RE.test(l))) Settings.themeLinks = [...Settings.themeLinks, THEME_LINK];
}

async function migrateLegacy(raw: Record<string, any>) {
    // settings from the old "Darkness" plugin name
    const old = Settings.plugins.Darkness as Record<string, any> | undefined;
    if (old && typeof old.dzVersion === "number" && raw.dzVersion === undefined) {
        for (const [k, v] of Object.entries(old)) if (k !== "enabled") raw[k] = v;
        for (const key of ["homeLogo", "profiles"]) {
            const v = await DataStore.get(`Darkness_${key}`);
            if (v !== undefined) await DataStore.set(`Terono_${key}`, v);
        }
    }

    if (typeof raw.homeLogo === "string") raw.logoUrl = raw.homeLogo;
    if (typeof raw.secondary === "string") raw.bgColor2 = raw.secondary;
    if (raw.animatedBackground === false) raw.background = "static";
    if (typeof raw.accent === "string" && !Object.values(ACCENTS).includes(raw.accent.toLowerCase())) raw.accentPreset ??= "custom";
    if (typeof raw.cardColor === "string" && !Object.values(CARDS).some(c => c.card === raw.cardColor.toLowerCase())) raw.cardPreset ??= "custom";

    // DM header got its own layout
    if (raw.dmHeaderName === undefined) {
        raw.dmHeaderName = raw.hideDmName === false ? raw.headerName ?? "left" : "hidden";
        raw.dmHeaderButtons = raw.headerButtons ?? "left";
        raw.dmHeaderSearch = raw.headerSearch ?? "right";
    }

    if (typeof raw.logoUrl !== "string" || /postimg\.cc\/(0yPDxpRb|Sxd1C6WT|6py1Lxtb)\//.test(raw.logoUrl) || raw.logoUrl === DEFAULT_LOGO) raw.logoUrl = "";
    if (raw.dzVersion === undefined || raw.dzVersion < 4) raw.logoSource = "url";
    if (raw.serverList === "horizontal") raw.serverList = "top";
    else if (raw.serverList === "vertical") raw.serverList = "left";

    for (const k of ["homeLogo", "secondary", "animatedBackground", "gifFirst", "preset", "hideDmName"]) delete raw[k];
}

/* ================= plugin ================= */

export default definePlugin({
    name: "Terono",
    description: "Companion for the Terono theme by Terona Studios: colors, cards, card media, background, layout, header, home logo, loading screens, chat bar, activities, menu cleanup, auto-translate, profiles and a hub for the plugins it pairs with.",
    authors: [{ name: "Terona Studios", id: 0n }],
    enabledByDefault: true,
    // marks your own messages (data-is-self), which the message sides option needs
    dependencies: ["ThemeAttributes"],
    settings,

    // "Start an Activity": conditional renders at the call sites (toggling never breaks hook order)
    patches: [
        {
            // call view control tray
            find: "CenterControlTray",
            replacement: {
                match: /!(\i)&&(\(0,\i\.jsx\)\(\i,\{channel:\i,idle:)/,
                replace: "!$1&&$self.showActivities()&&$2",
            },
        },
        {
            // voice panel button row
            find: /canGoLive:\i,enableActivities:\i,disabled:/,
            replacement: {
                match: /(\i)&&(\(0,\i\.jsx\)\(\i,\{channel:\i,enableActivities:\i\}\))/,
                replace: "$1&&$self.showActivities()&&$2",
            },
        },
        {
            // "Choose Activity" tile in the call grid
            find: /\{dismissedActivityEntryPointTileChannel:\i\}=/,
            replacement: [
                {
                    match: /\i>=2&&\i&&!\i&&!\i\?/,
                    replace: "$self.showActivities()&&$&",
                },
                {
                    match: /\i&&1===\i&&\i&&\i\.push/,
                    replace: "$self.showActivities()&&$&",
                },
            ],
        },
        {
            // member list role header: "Founder — 1" -> configurable format
            find: /title:\i,count:\i,guildId:\i,className:\i\}=\i/,
            replacement: {
                match: /null==(\i)\?null:\(0,(\i)\.jsxs\)\("span",\{children:\["\\xa0\\u2014 ",\i\]\}\)/,
                replace: "null==$1?null:(0,$2.jsx)($self.RoleCount,{count:$1})",
            },
        },
        {
            // profile connections: Discord always uses the logo made for a white circle
            find: /platformIcon:\i\?\.icon\.lightPNG/,
            replacement: [
                {
                    match: /platformIcon:(\i)\?\.icon\.lightPNG/,
                    replace: "platformIcon:$self.connectionIcon($1,arguments[0]?.account)",
                },
                {
                    match: /(className:\i\(\)\(\i\.\i,\i\?\i\.\i:null\),src:\i)\}/,
                    replace: "$1,onLoad:$self.connectionIconLoaded,onError:$self.connectionIconLoaded}",
                },
            ],
        },
    ],

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId?: string | null; }) {
            syncChannelKind(channelId);
        },
    },

    showActivities: () => settings.store.showActivities,
    overlayAction,
    connectionIcon,
    connectionIconLoaded,
    RoleCount,

    // auto-translate is off by default: then no per-message hook at all (thousands of messages on big servers)
    renderMessageAccessory: props => settings.store.autoTranslate ? <AutoTranslate message={props.message} /> : null,

    // theme presets, also reachable from the console: Vencord.Plugins.plugins.Terono.applyPresetById("crimson")
    presets: PRESETS,
    applyPresetById(id: string) {
        const p = PRESETS.find(x => x.id === id);
        if (p) applyPreset(p);
        return !!p;
    },

    // every step on its own: one that fails (a Discord update, an unusual setup) is recorded for the debug info
    // and the rest still starts, instead of the whole look silently not applying
    async start() {
        safely("theme", useBuiltInTheme); // first, so the look is there on the first frame
        try { await migrate(); } catch (e) { recordError("migrate", e); }
        try { await restoreUnfinishedPreview(); } catch (e) { recordError("preview", e); }
        safely("motion", () => {
            setPauseWhenUnfocused(settings.store.pauseUnfocused);
            startMotion();
        });
        safely("apply", applyAll);
        safely("darkerPalette", applyDarkerPalette);
        safely("logo", loadUploadedLogo);
        safely("files", loadStoredFiles);
        safely("branding", startBranding);
        safely("shapes", startShapes);
        safely("bulk", startBulk);
        safely("calls", startCall);
        SettingsStore.addGlobalChangeListener(onSettingsChange);
        safely("badges", startBadges); // before the creator badge, which then shows first
        safely("usage", () => startUsage(() => settings.store.shareUsage));
        safely("taskbarIcon", () => setTaskbarIcon(settings.store.taskbarIcon));
        safely("creatorBadges", () => {
            addProfileBadge(creatorBadge);
            addProfileBadge(vrocaBadge);
        });
        badgeStyle = Object.assign(document.createElement("style"), { id: "terono-badges", textContent: BADGE_CSS + PREVIEW_CSS + SHAPES_CSS + BULK_CSS + CALL_CSS });
        document.head.append(badgeStyle);
        safely("menus", () => addGlobalContextMenuPatch(menuPatch));
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKeyDown, true);
        safely("channelKind", () => syncChannelKind(SelectedChannelStore.getChannelId()));

        safely("updated", () => announceUpdated(settings.store.lastVersion));
        settings.store.lastVersion = VERSION;
        safely("updates", () => startAutoCheck(() => settings.store.autoUpdateCheck, () => settings.store.autoUpdate));
    },

    stop() {
        removeGlobalContextMenuPatch(menuPatch);
        SettingsStore.removeGlobalChangeListener(onSettingsChange);
        removeProfileBadge(creatorBadge);
        removeProfileBadge(vrocaBadge);
        stopUsage();
        stopBadges();
        setTaskbarIcon(false);
        badgeStyle?.remove();
        badgeStyle = null;
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
        detachHeader();
        stopAutoCheck();
        cancelPreview();
        stopMotion();
        stopBranding();
        stopShapes();
        stopBulk();
        stopCall();
        stopOverlay();
        forgetOverlay();
        removeAll();
        safely("theme", leaveThemeLink);
    },
});
