/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings, useSettings } from "@api/Settings";
import { HeadingTertiary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { localStorage } from "@utils/localStorage";
import { OptionType, PluginNative } from "@utils/types";
import { useEffect, useRef, useState } from "@webpack/common";

import { TERONO_LOGO } from "./assets";
import { IconSwaps } from "./branding";
import { applyAmbient } from "./call";
import { MyLookPanel, PeoplePanel } from "./cosmetics";
import { DebugInfo } from "./diagnostics";
import { DVD_CSS, startDvd, stopDvd } from "./dvd";
import { attachHeader } from "./header";
import { HSL_BOTTOM_CSS, HSL_CSS } from "./hsl";
import { addTicker, isAway, MOTION_STEP_MS, removeTicker, setPauseWhenUnfocused } from "./motion";
import { syncOverlay } from "./overlay";
import { ProfilesPanel } from "./profiles";
import { TeronoSettings } from "./settingsUi";
import { toast } from "./toast";
import { isOwner, UsagePanel } from "./usage";

export const DEFAULT_LOGO = TERONO_LOGO;
export const LOGO_KEY = "Terono_homeLogo";
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const LOGO_DATA_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
export const HEX_RE = /^#[0-9a-f]{6}$/i;

export const URL_RE = /^https:\/\/[^\s"'()\\]+$/;

export const ACCENTS: Record<string, string> = {
    blue: "#429cff", red: "#ff4d5e", purple: "#9b6dff", green: "#3ecf8e", pink: "#ff5fa8", orange: "#ff8a3d",
};

export const CARDS: Record<string, { card: string; text: string; }> = {
    dark: { card: "#070708", text: "#f1f2f4" },
    gray: { card: "#1e1f22", text: "#f2f3f5" },
    white: { card: "#f4f5f7", text: "#1a1b1e" },
};

// [xs, sm, md, lg, xl]
const RADII: Record<string, [number, number, number, number, number]> = {
    sharp: [2, 2, 2, 2, 2],
    soft: [4, 6, 8, 12, 16],
    curved: [6, 8, 12, 18, 24],
    round: [8, 12, 16, 24, 32],
};

export type ColorKey = "accent" | "voice" | "close" | "minimize" | "maximize"
    | "cardColor" | "cardColor2" | "textColor" | "iconColor" | "bgBase" | "bgColor1" | "bgColor2" | "embedColor" | "embedColor2"
    | "borderColor" | "borderColor2" | "selectionColor";

const COLOR_DEFAULTS: Record<ColorKey, string> = {
    accent: "#429cff", voice: "#35b889", close: "#d94a5d", minimize: "#d29b2e", maximize: "#35b889",
    cardColor: "#070708", cardColor2: "#0b1a33", textColor: "#f1f2f4", iconColor: "#9ea3ab",
    bgBase: "#000000", bgColor1: "#429cff", bgColor2: "#0b2a55",
    embedColor: "#16181d", embedColor2: "#0b2a55",
    borderColor: "#429cff", borderColor2: "#9b6dff",
    selectionColor: "#2f6fb3",
};

/* ================= live color preview =================
   Dragging a picker only rewrites one small <style>; settings are saved once when the picker closes. */

const preview: Partial<Record<ColorKey, string>> = {};
let previewFrame = 0;
let commitTimer = 0;
// one fixed path list per color (a new array every render would re-subscribe every render)
const COLOR_PATHS = new Proxy({} as Record<string, any[]>, { get: (cache, id: string) => cache[id] ??= [`plugins.Terono.${id}`] });

function ColorRow({ id, label, note }: { id: ColorKey; label: string; note: string; }) {
    const value = useSettings(COLOR_PATHS[id]).plugins.Terono[id] as string;
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const el = ref.current!;
        const commit = () => {
            delete preview[id];
            settings.store[id] = el.value;
            if (id === "accent") settings.store.accentPreset = "custom";
            applyVars();
        };
        el.addEventListener("change", commit);
        return () => el.removeEventListener("change", commit);
    }, []);

    // a value changed elsewhere (preset, profile): shown without re-creating the input, which would close an open picker
    useEffect(() => {
        const el = ref.current;
        if (el && el.value !== value && !(id in preview)) el.value = value;
    }, [value]);

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
                ref={ref}
                type="color"
                defaultValue={value}
                onChange={e => {
                    const v = e.currentTarget.value;
                    preview[id] = v;
                    if (!previewFrame) previewFrame = requestAnimationFrame(() => { previewFrame = 0; applyVars(); });
                    // also saved shortly after dragging stops: the picker's closing event doesn't fire the same way everywhere
                    clearTimeout(commitTimer);
                    commitTimer = window.setTimeout(() => {
                        if (preview[id] !== v) return;
                        delete preview[id];
                        settings.store[id] = v;
                        if (id === "accent") settings.store.accentPreset = "custom";
                        applyVars();
                    }, 500);
                }}
                style={{ width: 44, height: 30, border: "none", padding: 0, background: "none", cursor: "pointer", flexShrink: 0 }}
            />
            <div>
                <HeadingTertiary>{label}</HeadingTertiary>
                <Paragraph>{note}</Paragraph>
            </div>
        </div>
    );
}

const color = (id: ColorKey, label: string, note: string, hidden?: () => boolean) => ({
    type: OptionType.COMPONENT as const,
    default: COLOR_DEFAULTS[id],
    hidden,
    // for the settings search
    dzLabel: label,
    dzNote: note,
    component: () => <ColorRow id={id} label={label} note={note} />,
});

/* ================= home logo upload ================= */

let uploadedLogo: string | null = null;
export const getUploadedLogo = () => uploadedLogo;

export async function setUploadedLogo(dataUrl: string | null) {
    uploadedLogo = dataUrl;
    if (dataUrl) await DataStore.set(LOGO_KEY, dataUrl);
    else await DataStore.del(LOGO_KEY);
    applyLogo();
}

export async function loadUploadedLogo() {
    const stored = await DataStore.get<string>(LOGO_KEY);
    uploadedLogo = typeof stored === "string" && LOGO_DATA_RE.test(stored) ? stored : null;
    applyLogo();
}

function LogoUpload() {
    const [preview, setPreview] = useState(uploadedLogo);

    async function onFile(file: File | undefined) {
        if (!file) return;
        if (!LOGO_TYPES.includes(file.type)) return toast("Use a PNG, JPG, GIF, WEBP or SVG image.", "failure");
        if (file.size > LOGO_MAX_BYTES) return toast("Image must be 5 MB or smaller.", "failure");

        const dataUrl = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(file);
        });
        if (!LOGO_DATA_RE.test(dataUrl)) return toast("That file isn't a valid image.", "failure");

        settings.store.logoSource = "file";
        await setUploadedLogo(dataUrl);
        setPreview(dataUrl);
        toast("Home logo updated.", "success");
    }

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {preview && <img src={preview} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />}
            <div>
                <HeadingTertiary>Home logo file</HeadingTertiary>
                <Paragraph>PNG, JPG, GIF, WEBP or SVG up to 5 MB. Stored only on this PC.</Paragraph>
                <input type="file" accept={LOGO_TYPES.join(",")} onChange={e => onFile(e.currentTarget.files?.[0])} style={{ marginTop: 6, color: "var(--text-default)" }} />
            </div>
        </div>
    );
}

/* ================= font picker ================= */

// one fixed list: the picker only listens to the font setting
const FONT_PATH = ["plugins.Terono.font"] as any[];

function FontPicker() {
    const groups = ["All", ...new Set(FONT_LIST.map(f => f[2]))];
    useSettings(FONT_PATH);
    const current = settings.store.font;
    const [q, setQ] = useState("");
    const [group, setGroup] = useState("All");
    useEffect(loadFontPreviews, []);
    const w = q.trim().toLowerCase();
    const shown = FONT_LIST.filter(([k, f, g]) => (group === "All" || g === group) && (!w || `${f} ${FONT_LABELS[k] ?? ""} ${g}`.toLowerCase().includes(w)));
    const pick = (v: string) => { settings.store.font = v; applyFont(); };

    return (
        <div className="dz-fontpick">
            <div className="dz-fontpick-bar">
                <input className="dz-input dz-grow" placeholder={`Search ${FONT_LIST.length} fonts`} value={q} onChange={e => setQ(e.currentTarget.value)} />
                <button className={`dz-chip ${current === "custom" ? "dz-on" : ""}`} onClick={() => pick("custom")}>Your own file</button>
            </div>
            <div className="dz-prof-chips">
                {groups.map(g => <button key={g} className={`dz-chip ${group === g ? "dz-on" : ""}`} onClick={() => setGroup(g)}>{g}</button>)}
            </div>
            <div className="dz-fonts" role="radiogroup" aria-label="Font">
                {shown.map(([value, family]) => (
                    <button key={value} role="radio" aria-checked={current === value} className="dz-font" style={{ fontFamily: fontStack(value) }} onClick={() => pick(value)}>
                        <span className="dz-font-name">{FONT_LABELS[value] ?? family}</span>
                        <span className="dz-font-sample">The quick brown fox 123</span>
                    </button>
                ))}
                {shown.length === 0 && <p className="dz-look-note">No font matches.</p>}
            </div>
        </div>
    );
}

/* ================= background media + custom font (files kept on this PC, IndexedDB) ================= */

export const MEDIA_KEY = "Terono_bgMedia";
export const CARD_MEDIA_KEY = "Terono_cardMedia";
export const FONT_KEY = "Terono_customFont";
export const BORDER_KEY = "Terono_appBorder";
export const DVD_KEY = "Terono_dvdImage";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const FONT_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm"];
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;

let mediaBlob: Blob | null = null;
let mediaUrl: string | null = null;
let cardBlob: Blob | null = null;
let customFont: FontFace | null = null;
let borderUrl: string | null = null;
let dvdUrl: string | null = null;

export async function loadStoredFiles() {
    const media = await DataStore.get<Blob>(MEDIA_KEY);
    mediaBlob = media instanceof Blob && MEDIA_TYPES.includes(media.type) ? media : null;
    const card = await DataStore.get<Blob>(CARD_MEDIA_KEY);
    cardBlob = card instanceof Blob && MEDIA_TYPES.includes(card.type) ? card : null;
    const border = await DataStore.get<Blob>(BORDER_KEY);
    setBorderBlob(border instanceof Blob && IMAGE_TYPES.includes(border.type) ? border : null);
    const dvd = await DataStore.get<Blob>(DVD_KEY);
    setDvdBlob(dvd instanceof Blob && IMAGE_TYPES.includes(dvd.type) ? dvd : null);
    const font = await DataStore.get<ArrayBuffer>(FONT_KEY);
    if (font instanceof ArrayBuffer) await registerFont(font);
    applyMedia();
    applyCardMedia();
    applyFont();
    applyBorder();
    applyDvd();
}

function setDvdBlob(b: Blob | null) {
    if (dvdUrl) URL.revokeObjectURL(dvdUrl);
    dvdUrl = b ? URL.createObjectURL(b) : null;
}

async function onDvdFile(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) return toast("Use PNG, JPG, GIF or WEBP.", "failure");
    if (file.size > 20 * 1024 * 1024) return toast("The picture must be 20 MB or smaller.", "failure");
    setDvdBlob(file);
    await DataStore.set(DVD_KEY, file);
    settings.store.dvd = true;
    applyDvd();
    toast("Bouncing picture updated.", "success");
}

async function clearDvdFile() {
    setDvdBlob(null);
    await DataStore.del(DVD_KEY);
    applyDvd();
    toast("Back to the DVD logo.", "success");
}

export function applyDvd() {
    const s = settings.store;
    sheet("dvd", s.dvd ? DVD_CSS : "");
    if (!s.dvd) return stopDvd();
    startDvd({
        size: Math.max(40, Math.min(400, Number(s.dvdSize) || 150)),
        speed: Math.max(20, Math.min(300, Number(s.dvdSpeed) || 90)),
        image: dvdUrl,
        strictPause: !!(s.lite || s.ultra),
    });
}

function setBorderBlob(b: Blob | null) {
    if (borderUrl) URL.revokeObjectURL(borderUrl);
    borderUrl = b ? URL.createObjectURL(b) : null;
}

async function onBorderFile(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) return toast("Use PNG, JPG, GIF or WEBP.", "failure");
    if (file.size > 20 * 1024 * 1024) return toast("The frame picture must be 20 MB or smaller.", "failure");
    setBorderBlob(file);
    await DataStore.set(BORDER_KEY, file);
    settings.store.appBorder = "image";
    applyBorder();
    toast("Frame picture updated.", "success");
}

async function registerFont(buf: ArrayBuffer) {
    if (customFont) document.fonts.delete(customFont);
    customFont = null;
    try {
        const face = new FontFace("Terono Custom", buf);
        await face.load();
        document.fonts.add(face);
        customFont = face;
    } catch {
        toast("That font file could not be loaded.", "failure");
    }
}

function FileRow({ title, note, accept, onFile }: { title: string; note: string; accept: string; onFile(f: File): void; }) {
    return (
        <div>
            <HeadingTertiary>{title}</HeadingTertiary>
            <Paragraph>{note}</Paragraph>
            <input type="file" accept={accept} onChange={e => { const f = e.currentTarget.files?.[0]; if (f) onFile(f); }} style={{ marginTop: 6, color: "var(--text-default)" }} />
        </div>
    );
}

async function onMediaFile(file: File) {
    if (!MEDIA_TYPES.includes(file.type)) return toast("Use PNG, JPG, GIF, WEBP, MP4 or WEBM.", "failure");
    if (file.size > MEDIA_MAX_BYTES) return toast("Background file must be 100 MB or smaller.", "failure");
    mediaBlob = file;
    dropObjectUrl("bg");
    await DataStore.set(MEDIA_KEY, file);
    settings.store.bgMediaSource = "file";
    applyMedia();
    toast("Background updated.", "success");
}

async function onCardMediaFile(file: File) {
    if (!MEDIA_TYPES.includes(file.type)) return toast("Use PNG, JPG, GIF, WEBP, MP4 or WEBM.", "failure");
    if (file.size > MEDIA_MAX_BYTES) return toast("Card media must be 100 MB or smaller.", "failure");
    cardBlob = file;
    dropObjectUrl("card");
    await DataStore.set(CARD_MEDIA_KEY, file);
    settings.store.cardMedia = "file";
    applyCardMedia();
    toast("Card media updated.", "success");
}

async function onFontFile(file: File) {
    if (!FONT_EXT.test(file.name)) return toast("Use a TTF, OTF, WOFF or WOFF2 font.", "failure");
    if (file.size > FONT_MAX_BYTES) return toast("Font must be 10 MB or smaller.", "failure");
    const buf = await file.arrayBuffer();
    await registerFont(buf);
    if (!customFont) return;
    await DataStore.set(FONT_KEY, buf);
    settings.store.font = "custom";
    applyFont();
    toast("Custom font applied.", "success");
}

// Google Fonts (fonts.googleapis.com / gstatic are on Vencord's default allow-list): [setting value, family, group].
// The values of fonts from earlier versions never change, so saved settings and profiles keep their font.
export const FONT_LIST: [string, string, string][] = [
    ["discord", "", "Clean"],
    ["terono", "Figtree", "Clean"],
    ["inter", "Inter", "Clean"],
    ["roboto", "Roboto", "Clean"],
    ["dmsans", "DM Sans", "Clean"],
    ["worksans", "Work Sans", "Clean"],
    ["plex", "IBM Plex Sans", "Clean"],
    ["ubuntu", "Ubuntu", "Clean"],
    ["manrope", "Manrope", "Clean"],
    ["jakarta", "Plus Jakarta Sans", "Clean"],
    ["lexend", "Lexend", "Clean"],
    ["onest", "Onest", "Clean"],
    ["geist", "Geist", "Clean"],
    ["instrument", "Instrument Sans", "Clean"],
    ["albert", "Albert Sans", "Clean"],
    ["redhat", "Red Hat Display", "Clean"],
    ["hanken", "Hanken Grotesk", "Clean"],
    ["schibsted", "Schibsted Grotesk", "Clean"],
    ["rubik", "Rubik", "Clean"],
    ["nunito", "Nunito", "Rounded"],
    ["quicksand", "Quicksand", "Rounded"],
    ["comfortaa", "Comfortaa", "Rounded"],
    ["varela", "Varela Round", "Rounded"],
    ["mplus", "M PLUS Rounded 1c", "Rounded"],
    ["baloo", "Baloo 2", "Rounded"],
    ["fredoka", "Fredoka", "Rounded"],
    ["poppins", "Poppins", "Geometric"],
    ["montserrat", "Montserrat", "Geometric"],
    ["outfit", "Outfit", "Geometric"],
    ["sora", "Sora", "Geometric"],
    ["urbanist", "Urbanist", "Geometric"],
    ["spacegrotesk", "Space Grotesk", "Geometric"],
    ["syne", "Syne", "Geometric"],
    ["unbounded", "Unbounded", "Geometric"],
    ["archivo", "Archivo", "Geometric"],
    ["kanit", "Kanit", "Geometric"],
    ["bricolage", "Bricolage Grotesque", "Geometric"],
    ["playfair", "Playfair Display", "Serif"],
    ["lora", "Lora", "Serif"],
    ["fraunces", "Fraunces", "Serif"],
    ["dmserif", "DM Serif Display", "Serif"],
    ["instrumentserif", "Instrument Serif", "Serif"],
    ["youngserif", "Young Serif", "Serif"],
    ["merriweather", "Merriweather", "Serif"],
    ["righteous", "Righteous", "Display"],
    ["audiowide", "Audiowide", "Display"],
    ["orbitron", "Orbitron", "Display"],
    ["bungee", "Bungee", "Display"],
    ["russo", "Russo One", "Display"],
    ["michroma", "Michroma", "Display"],
    ["exo", "Exo 2", "Display"],
    ["rajdhani", "Rajdhani", "Display"],
    ["oxanium", "Oxanium", "Display"],
    ["chakra", "Chakra Petch", "Display"],
    ["grandstander", "Grandstander", "Display"],
    ["lilita", "Lilita One", "Display"],
    ["silkscreen", "Silkscreen", "Display"],
    ["pressstart", "Press Start 2P", "Display"],
    ["caveat", "Caveat", "Handwritten"],
    ["patrick", "Patrick Hand", "Handwritten"],
    ["gochi", "Gochi Hand", "Handwritten"],
    ["kalam", "Kalam", "Handwritten"],
    ["comicneue", "Comic Neue", "Handwritten"],
    ["shantell", "Shantell Sans", "Handwritten"],
    ["jetbrains", "JetBrains Mono", "Mono"],
    ["firacode", "Fira Code", "Mono"],
    ["spacemono", "Space Mono", "Mono"],
    ["plexmono", "IBM Plex Mono", "Mono"],
    ["geistmono", "Geist Mono", "Mono"],
    ["vt323", "VT323", "Mono"],
];
const FONTS: Record<string, string> = Object.fromEntries(FONT_LIST.map(([k, f]) => [k, f]));
const FONT_LABELS: Record<string, string> = { discord: "Discord (gg sans)", terono: "Terono (Figtree)" };

/* ================= settings ================= */

const custom = (key: "accentPreset" | "cardPreset") => () => settings.store[key] !== "custom";

export const settings = definePluginSettings({
    // the whole settings screen (tabs); every option below is drawn inside it
    ui: {
        type: OptionType.COMPONENT,
        component: () => <TeronoSettings />,
    },
    presetId: {
        type: OptionType.STRING,
        description: "Last theme preset applied (shown as \"Customized\" once changed).",
        default: "",
    },
    autoUpdate: {
        type: OptionType.BOOLEAN,
        description: "Update Terono by itself: when Discord starts (and every few hours) a new version is installed in the background and used from the next start. You get a notification with a restart button.",
        default: true,
    },
    autoUpdateCheck: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a new Terono is out (when automatic updates are off or can't be used).",
        default: true,
    },
    overlayShow: {
        type: OptionType.SELECT,
        description: "Beta: the Terono overlay, in your Terono look: a see-through panel over your games and other apps (windowed or borderless) with the call you're in, who's talking, and your DMs and mentions as they come in. Clicks go through it to the game. Hidden while Discord is in front. Desktop app only.",
        options: [
            { label: "On: calls and messages over other apps", value: "on", default: true },
            { label: "Only when I press the hotkey", value: "hotkey" },
            { label: "Off", value: "off" },
        ],
        onChange: () => applyOverlay(),
    },
    overlayKey: {
        type: OptionType.SELECT,
        description: "Makes the overlay clickable: mute, deafen, leave the call, open a message in Discord. Press it again (or Esc) to go back to your game.",
        options: [
            { label: "Ctrl + Shift + O", value: "Control+Shift+O", default: true },
            { label: "Ctrl + Shift + Space", value: "Control+Shift+Space" },
            { label: "Alt + ` (key left of 1)", value: "Alt+`" },
            { label: "Ctrl + Alt + D", value: "Control+Alt+D" },
            { label: "Shift + Tab", value: "Shift+Tab" },
            { label: "No hotkey", value: "" },
        ],
        hidden: () => settings.store.overlayShow === "off",
        onChange: () => applyOverlay(),
    },
    overlayCorner: {
        type: OptionType.SELECT,
        description: "Corner of the screen it sits in.",
        options: [
            { label: "Top left", value: "top-left", default: true },
            { label: "Top right", value: "top-right" },
            { label: "Bottom left", value: "bottom-left" },
            { label: "Bottom right", value: "bottom-right" },
        ],
        hidden: () => settings.store.overlayShow === "off",
        onChange: () => applyOverlay(),
    },
    overlayCompact: {
        type: OptionType.BOOLEAN,
        description: "In a call, only list who's talking right now (and you), instead of everyone.",
        default: false,
        hidden: () => settings.store.overlayShow === "off",
        onChange: () => applyOverlay(),
    },
    overlayToasts: {
        type: OptionType.BOOLEAN,
        description: "Pop up DMs and messages that mention you.",
        default: true,
        hidden: () => settings.store.overlayShow === "off",
    },
    overlayOpacity: {
        type: OptionType.SLIDER,
        description: "How solid the overlay is (%).",
        markers: [40, 50, 60, 70, 80, 90, 100],
        default: 100,
        stickToMarkers: false,
        hidden: () => settings.store.overlayShow === "off",
        onChange: () => applyOverlay(),
    },
    callAmbient: {
        type: OptionType.BOOLEAN,
        description: "Beta: ambient mode: the colors of the stream you're watching glow softly around it, like on YouTube.",
        default: true,
        onChange: () => applyAmbient(),
    },
    bulkMode: {
        type: OptionType.BOOLEAN,
        description: "Beta: Hold Ctrl and click servers, DMs or friends to select several, then right-click one of them: whatever you pick in Discord's menu is done to all of them. Esc clears the selection.",
        default: true,
    },
    homeDoubleClick: {
        type: OptionType.BOOLEAN,
        description: "Double-click the Home button (top of the server list) to mark every server and DM as read.",
        default: true,
    },
    openKeybind: {
        type: OptionType.BOOLEAN,
        description: "Ctrl + 1 opens these settings from anywhere in Discord.",
        default: true,
    },
    taskbarIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the Terono logo as Discord's icon on the taskbar, in the Start menu and on desktop shortcuts (Windows). Turn it off to get Discord's own icon back.",
        default: true,
        hidden: () => !IS_DISCORD_DESKTOP || navigator.platform !== "Win32",
    },
    shareUsage: {
        type: OptionType.BOOLEAN,
        description: "Count me in the number of Terono users. Sends only a one-way hash of your Discord user ID about once a day, and tells the server you're online while Discord is open. Turn it off and nothing is sent.",
        default: true,
    },
    usageCount: {
        type: OptionType.COMPONENT,
        component: () => <UsagePanel />,
        hidden: () => !isOwner(),
    },
    lastVersion: {
        type: OptionType.STRING,
        description: "Terono version that last ran (shows the \"updated\" message once after an update).",
        default: "",
        hidden: true,
    },
    profiles: {
        type: OptionType.COMPONENT,
        component: () => <ProfilesPanel />,
    },
    debugInfo: {
        type: OptionType.COMPONENT,
        component: () => <DebugInfo />,
    },

    /* --- you: profile look, people, avatars --- */
    myLook: {
        type: OptionType.COMPONENT,
        component: () => <MyLookPanel />,
    },
    people: {
        type: OptionType.COMPONENT,
        component: () => <PeoplePanel />,
    },
    // your own name styles for other people (cosmetics.tsx), JSON
    peopleLooks: {
        type: OptionType.STRING,
        description: "Name styles for other people.",
        default: "{}",
        hidden: true,
    },
    namesEverywhere: {
        type: OptionType.BOOLEAN,
        description: "Show name fonts, colors and effects everywhere, all the time: Discord only shows them in DMs, and the color and effect only while you point at the name. (Servers: after a restart.)",
        default: true,
        onChange: () => applyAttrs(),
    },
    avatarShape: {
        type: OptionType.SELECT,
        description: "Shape of everyone's profile pictures (only you see this).",
        options: [
            { label: "Circle (Discord)", value: "circle", default: true },
            { label: "Rounded square", value: "rounded" },
            { label: "Square", value: "square" },
        ],
        onChange: () => applyAttrs(),
    },

    /* --- tools --- */
    searchTools: {
        type: OptionType.BOOLEAN,
        description: "Media, links and files buttons next to the search bar: all pictures and videos of a chat as a grid, every link (with a search inside the links, e.g. \"kori\" finds coolify.kori.my), or every file.",
        default: true,
    },
    blockedButton: {
        type: OptionType.BOOLEAN,
        description: "A \"Blocked\" button next to \"Add Friend\" on the friends page, with everyone you've blocked.",
        default: true,
    },

    /* --- accent --- */
    accentPreset: {
        type: OptionType.SELECT,
        description: "Primary color used for buttons, links, selection, mentions and glow.",
        options: [
            { label: "Blue", value: "blue", default: true },
            { label: "Red", value: "red" },
            { label: "Purple", value: "purple" },
            { label: "Green", value: "green" },
            { label: "Pink", value: "pink" },
            { label: "Orange", value: "orange" },
            { label: "Custom", value: "custom" },
        ],
        onChange: () => applyVars(),
    },
    accent: color("accent", "Primary color", "Pick any color (switches the preset to Custom); presets fill it in for you."),
    voice: color("voice", "Voice / online", "Voice Connected, online status, speaking ring."),
    close: color("close", "Close button", "Window close dot."),
    minimize: color("minimize", "Minimize button", "Window minimize dot."),
    maximize: color("maximize", "Maximize button", "Window maximize dot."),
    customText: {
        type: OptionType.BOOLEAN,
        description: "Use your own text color instead of the one that comes with the card colors. Muted text (descriptions, timestamps) is derived from it.",
        default: false,
        onChange: () => applyVars(),
    },
    appBorder: {
        type: OptionType.SELECT,
        description: "A frame around the whole app window.",
        options: [
            { label: "None", value: "none", default: true },
            { label: "One color", value: "color" },
            { label: "Gradient", value: "gradient" },
            { label: "Picture (file)", value: "image" },
        ],
        onChange: () => applyBorder(),
    },
    borderColor: color("borderColor", "Border color", "Frame color (gradient start).", () => settings.store.appBorder !== "color" && settings.store.appBorder !== "gradient"),
    borderColor2: color("borderColor2", "Border gradient end", "Second color of the frame gradient.", () => settings.store.appBorder !== "gradient"),
    appBorderFile: {
        type: OptionType.COMPONENT,
        hidden: () => settings.store.appBorder !== "image",
        component: () => <FileRow title="Frame picture" note="PNG, JPG, GIF or WEBP up to 20 MB, stretched around the window. Stored only on this PC." accept={IMAGE_TYPES.join(",")} onFile={onBorderFile} />,
    },
    dvd: {
        type: OptionType.BOOLEAN,
        description: "A logo bouncing around behind the panels, like an old DVD player. About half of its bounces go for a corner. Smooth 60 fps, also during calls and streams; it stops while Discord is hidden, and in Performance or Ultimate performance mode also while Discord isn't in front.",
        default: false,
        onChange: () => applyDvd(),
    },
    dvdFile: {
        type: OptionType.COMPONENT,
        hidden: () => !settings.store.dvd,
        component: () => (
            <div>
                <FileRow title="Your own picture" note="PNG, JPG, GIF or WEBP up to 20 MB instead of the DVD logo. Stored only on this PC." accept={IMAGE_TYPES.join(",")} onFile={onDvdFile} />
                {dvdUrl && <button className="dz-file-btn" style={{ marginTop: 8 }} onClick={clearDvdFile}>Use the DVD logo again</button>}
            </div>
        ),
    },
    dvdSize: {
        type: OptionType.SLIDER,
        description: "Size (px wide).",
        markers: [60, 100, 150, 200, 260, 320],
        default: 150,
        stickToMarkers: false,
        hidden: () => !settings.store.dvd,
        onChange: () => applyDvd(),
    },
    dvdSpeed: {
        type: OptionType.SLIDER,
        description: "Speed (px per second).",
        markers: [40, 60, 90, 120, 160, 220],
        default: 90,
        stickToMarkers: false,
        hidden: () => !settings.store.dvd,
        onChange: () => applyDvd(),
    },
    appBorderWidth: {
        type: OptionType.SLIDER,
        description: "Frame width (px).",
        markers: [1, 2, 3, 4, 6, 8, 10, 12],
        default: 3,
        stickToMarkers: false,
        hidden: () => settings.store.appBorder === "none",
    },
    customIcons: {
        type: OptionType.BOOLEAN,
        description: "Use your own color for every icon: back/forward arrows, header buttons (pins, call, video), channel icons, the server list buttons, chat bar, member list and settings. Icons on filled buttons stay white. Off: icons follow the text color.",
        default: false,
        onChange: () => applyVars(),
    },
    iconColor: color("iconColor", "Icon color", "Icons at rest; hovered and selected icons get brighter.", () => !settings.store.customIcons),

    /* --- cards --- */
    cardPreset: {
        type: OptionType.SELECT,
        description: "Panel colors. Custom unlocks your own fill (solid or gradient). The text color is under Colors.",
        options: [
            { label: "Dark", value: "dark", default: true },
            { label: "Gray", value: "gray" },
            { label: "White", value: "white" },
            { label: "Custom", value: "custom" },
        ],
        onChange: () => applyAll(),
    },
    cardFill: {
        type: OptionType.SELECT,
        description: "Custom card fill.",
        options: [
            { label: "Solid color", value: "solid", default: true },
            { label: "Gradient", value: "gradient" },
        ],
        hidden: custom("cardPreset"),
        onChange: () => applyAll(),
    },
    cardColor: color("cardColor", "Card color", "Panel color (gradient start).", custom("cardPreset")),
    cardColor2: color("cardColor2", "Card gradient end", "Second color of the card gradient.", () => settings.store.cardPreset !== "custom" || settings.store.cardFill !== "gradient"),
    cardAngle: {
        type: OptionType.SLIDER,
        description: "Card gradient angle (degrees).",
        markers: [0, 45, 90, 135, 180, 225, 270, 315, 360],
        default: 135,
        stickToMarkers: false,
        hidden: () => settings.store.cardPreset !== "custom" || settings.store.cardFill !== "gradient",
        onChange: () => applyVars(),
    },
    textColor: color("textColor", "Text color", "Main text; muted shades are derived from it.", () => !settings.store.customText),
    customSelection: {
        type: OptionType.BOOLEAN,
        description: "Use your own color for selected (highlighted) text instead of the primary color.",
        default: false,
        onChange: () => applyVars(),
    },
    selectionColor: color("selectionColor", "Selection color", "Behind selected text; the text on it turns dark or light, whichever reads better.", () => !settings.store.customSelection),
    cardShape: {
        type: OptionType.SELECT,
        description: "Corners of panels, popouts and buttons.",
        options: [
            { label: "Sharp", value: "sharp" },
            { label: "Soft", value: "soft" },
            { label: "Curved", value: "curved", default: true },
            { label: "Round", value: "round" },
        ],
        onChange: () => applyVars(),
    },
    panels: {
        type: OptionType.SELECT,
        description: "Separate cards: Terono's floating panels with space between them. Joined: the panels touch like in normal Discord, with thin lines between them.",
        options: [
            { label: "Separate cards (Terono)", value: "cards", default: true },
            { label: "Joined, like Discord", value: "discord" },
        ],
        onChange: () => applyAttrs(),
    },
    cardStyle: {
        type: OptionType.SELECT,
        description: "Panel material. Glass: see-through panels. Liquid glass: see-through panels with soft light slowly flowing under them. Only the big panels change; buttons, menus and popups stay solid. Performance mode keeps liquid glass still.",
        options: [
            { label: "Solid", value: "solid", default: true },
            { label: "Glass", value: "glass" },
            { label: "Liquid glass", value: "liquid" },
        ],
        onChange: () => applyAll(),
    },
    glassOpacity: {
        type: OptionType.SLIDER,
        description: "Glass opacity (%).",
        markers: [20, 35, 50, 65, 80, 95],
        default: 60,
        stickToMarkers: false,
        hidden: () => settings.store.cardStyle === "solid",
        onChange: () => applyVars(),
    },
    cardMedia: {
        type: OptionType.SELECT,
        description: "Image, GIF or video inside the panels, separate from the app background. It runs across all panels as one picture with the card color laid over it. ⚠ GIFs and videos cost performance.",
        options: [
            { label: "None", value: "none", default: true },
            { label: "URL", value: "url" },
            { label: "File", value: "file" },
        ],
        onChange: () => applyAll(),
    },
    cardMediaUrl: {
        type: OptionType.STRING,
        description: "Direct link to an image, GIF or video (https) for the panels. The site must be allowed by Vencord (Discord CDN, imgur, GitHub, Tenor are).",
        default: "",
        hidden: () => settings.store.cardMedia !== "url",
        isValid: (v: string) => v === "" || URL_RE.test(v) || "Must be a plain https:// link",
    },
    cardMediaFile: {
        type: OptionType.COMPONENT,
        hidden: () => settings.store.cardMedia !== "file",
        component: () => <FileRow title="Card media file" note="PNG, JPG, GIF, WEBP, MP4 or WEBM up to 100 MB. Stored only on this PC." accept={MEDIA_TYPES.join(",")} onFile={onCardMediaFile} />,
    },
    cardMediaDim: {
        type: OptionType.SLIDER,
        description: "How much the card color covers the card media (%). Higher is easier to read.",
        markers: [0, 20, 40, 60, 80, 95],
        default: 60,
        stickToMarkers: false,
        hidden: () => settings.store.cardMedia === "none",
    },
    liquidColor: {
        type: OptionType.SELECT,
        description: "Color of the flowing light.",
        options: [
            { label: "Primary + background colors", value: "theme", default: true },
            { label: "White (clear glass)", value: "white" },
        ],
        hidden: () => settings.store.cardStyle !== "liquid",
        onChange: () => applyLiquid(),
    },
    liquidSpeed: {
        type: OptionType.SELECT,
        description: "How fast the light flows. Still: the light stays where it is (no motion at all).",
        options: [
            { label: "Still (no motion)", value: "still" },
            { label: "Slow", value: "slow", default: true },
            { label: "Medium", value: "medium" },
            { label: "Fast", value: "fast" },
        ],
        hidden: () => settings.store.cardStyle !== "liquid",
        onChange: () => applyLiquid(),
    },

    /* --- embeds (link previews) --- */
    embedStyle: {
        type: OptionType.SELECT,
        description: "Link previews and bot embeds in chat.",
        options: [
            { label: "Like the cards", value: "cards", default: true },
            { label: "One color", value: "solid" },
            { label: "Gradient", value: "gradient" },
            { label: "Glass", value: "glass" },
        ],
        onChange: () => applyAll(),
    },
    embedColor: color("embedColor", "Embed color", "Fill of embeds (gradient start). Their text turns dark or light to stay readable.", () => settings.store.embedStyle === "cards"),
    embedColor2: color("embedColor2", "Embed gradient end", "Second color of the embed gradient.", () => settings.store.embedStyle !== "gradient"),
    embedAngle: {
        type: OptionType.SLIDER,
        description: "Embed gradient angle (degrees).",
        markers: [0, 45, 90, 135, 180, 225, 270, 315, 360],
        default: 135,
        stickToMarkers: false,
        hidden: () => settings.store.embedStyle !== "gradient",
        onChange: () => applyVars(),
    },
    embedOpacity: {
        type: OptionType.SLIDER,
        description: "Embed glass opacity (%).",
        markers: [10, 25, 40, 55, 70, 85],
        default: 40,
        stickToMarkers: false,
        hidden: () => settings.store.embedStyle !== "glass",
        onChange: () => applyVars(),
    },
    glassBlur: {
        type: OptionType.BOOLEAN,
        description: "Blur behind glass panels. While blur is on the background animation pauses, because re-blurring a moving background is what makes Discord lag. With liquid glass the flowing light gets blurred too: smoother look, a bit more work for the graphics card.",
        default: true,
        hidden: () => settings.store.cardStyle === "solid",
        onChange: () => applyAttrs(),
    },

    /* --- background --- */
    background: {
        type: OptionType.SELECT,
        description: "Background behind the panels.",
        options: [
            { label: "Animated gradient", value: "animated", default: true },
            { label: "Static gradient", value: "static" },
            { label: "Solid color", value: "solid" },
            { label: "Image / GIF / Video", value: "media" },
        ],
        onChange: () => applyAttrs(),
    },
    bgMediaSource: {
        type: OptionType.SELECT,
        description: "⚠ Image / GIF / video backgrounds cost performance: GIFs and videos keep the GPU busy all the time, more so with Glass blur. Use Static or Solid on weak PCs.",
        options: [
            { label: "URL", value: "url", default: true },
            { label: "File", value: "file" },
        ],
        hidden: () => settings.store.background !== "media",
    },
    bgMediaUrl: {
        type: OptionType.STRING,
        description: "Direct link to an image, GIF or video (https). The site must be allowed by Vencord (Discord CDN, imgur, GitHub, Tenor are). If it can't load you get a message and the gradient stays.",
        default: "",
        hidden: () => settings.store.background !== "media" || settings.store.bgMediaSource !== "url",
        isValid: (v: string) => v === "" || URL_RE.test(v) || "Must be a plain https:// link",
    },
    bgMediaFile: {
        type: OptionType.COMPONENT,
        hidden: () => settings.store.background !== "media" || settings.store.bgMediaSource !== "file",
        component: () => <FileRow title="Background file" note="PNG, JPG, GIF, WEBP, MP4 or WEBM up to 100 MB. Stored only on this PC." accept={MEDIA_TYPES.join(",")} onFile={onMediaFile} />,
    },
    bgMediaDim: {
        type: OptionType.SLIDER,
        description: "Darken the background image / video (%), keeps text readable.",
        markers: [0, 20, 40, 60, 80],
        default: 30,
        stickToMarkers: false,
        hidden: () => settings.store.background !== "media",
    },
    bgBase: color("bgBase", "Background base", "Base color (the whole background when Solid)."),
    bgColor1: color("bgColor1", "Gradient color 1", "First glow of the background gradient.", () => settings.store.background === "solid"),
    bgColor2: color("bgColor2", "Gradient color 2", "Second glow of the background gradient.", () => settings.store.background === "solid"),

    /* --- layout --- */
    serverList: {
        type: OptionType.SELECT,
        description: "Server list position.",
        options: [
            { label: "Left (Discord default)", value: "left", default: true },
            { label: "Top (horizontal)", value: "top" },
            { label: "Bottom (horizontal)", value: "bottom" },
            { label: "Right (vertical)", value: "right" },
        ],
        onChange: () => applyAttrs(),
    },
    serverListDirection: {
        type: OptionType.SELECT,
        description: "Order of the servers in the horizontal list.",
        options: [
            { label: "Left to right", value: "ltr", default: true },
            { label: "Right to left", value: "rtl" },
        ],
        hidden: () => settings.store.serverList !== "top" && settings.store.serverList !== "bottom",
        onChange: () => applyAttrs(),
    },
    channelsSide: {
        type: OptionType.SELECT,
        description: "Channel / DM list side.",
        options: [
            { label: "Left", value: "left", default: true },
            { label: "Right", value: "right" },
        ],
        onChange: () => applyAttrs(),
    },
    membersSide: {
        type: OptionType.SELECT,
        description: "Member list / profile panel side (next to the chat).",
        options: [
            { label: "Right", value: "right", default: true },
            { label: "Left", value: "left" },
        ],
        onChange: () => applyAttrs(),
    },
    roleCount: {
        type: OptionType.SELECT,
        description: "Member list role headers: how the member count is shown.",
        options: [
            { label: "Role (1)", value: "paren", default: true },
            { label: "Role · 1", value: "dot" },
            { label: "Role [1]", value: "bracket" },
            { label: "Role 1", value: "space" },
            { label: "Role — 1 (Discord default)", value: "dash" },
            { label: "Role (no count)", value: "hidden" },
            { label: "Custom", value: "custom" },
        ],
    },
    roleCountCustom: {
        type: OptionType.STRING,
        description: "Custom role count. %users% is replaced by the number of members; without %users% nothing is shown. Example: • %users% online",
        default: "(%users%)",
        hidden: () => settings.store.roleCount !== "custom",
    },
    font: {
        type: OptionType.SELECT,
        description: "Font for the whole app.",
        options: [
            ...FONT_LIST.map(([value, family]) => ({ label: FONT_LABELS[value] ?? family, value, default: value === "terono" })),
            { label: "Custom (upload)", value: "custom" },
        ],
    },
    // the screen shows this picker instead of a dropdown: every font's name written in that font
    fontPicker: {
        type: OptionType.COMPONENT,
        component: () => <FontPicker />,
    },
    fontFile: {
        type: OptionType.COMPONENT,
        hidden: () => settings.store.font !== "custom",
        component: () => <FileRow title="Custom font" note="TTF, OTF, WOFF or WOFF2 up to 10 MB. Stored only on this PC." accept=".ttf,.otf,.woff,.woff2" onFile={onFontFile} />,
    },
    logoSource: {
        type: OptionType.SELECT,
        description: "Home logo source (shown in its original colors).",
        options: [
            { label: "URL", value: "url", default: true },
            { label: "File", value: "file" },
        ],
        onChange: () => applyLogo(),
    },
    logoUrl: {
        type: OptionType.STRING,
        description: "Home logo URL (https). Leave empty for the built-in Terono logo. The site must be allowed by Vencord (Discord CDN, imgur, GitHub are).",
        default: "",
        hidden: () => settings.store.logoSource !== "url",
        isValid: (v: string) => v === "" || URL_RE.test(v) || "Must be a plain https:// link",
        onChange: () => applyLogo(),
    },
    logoFile: {
        type: OptionType.COMPONENT,
        hidden: () => settings.store.logoSource !== "file",
        component: () => <LogoUpload />,
    },
    logoSize: {
        type: OptionType.SLIDER,
        description: "Home logo size (% of the button).",
        markers: [40, 50, 60, 70, 80, 90, 100],
        default: 72,
        stickToMarkers: false,
        onChange: () => applyVars(),
    },
    iconSwaps: {
        type: OptionType.COMPONENT,
        component: () => <IconSwaps />,
    },
    loadingScreen: {
        type: OptionType.BOOLEAN,
        description: "Terono loading screens: the Terono logo and name instead of Discord's while Discord starts, updates and connects. The updater window changes on the next start.",
        default: true,
        onChange: () => applyLoading(),
    },
    quickIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the Terono icon next to the back/forward arrows (opens these settings).",
        default: true,
        onChange: () => applyAttrs(),
    },

    /* --- server channel header --- */
    headerName: {
        type: OptionType.SELECT,
        description: "Servers: channel name position.",
        options: [
            { label: "Left", value: "left", default: true },
            { label: "Middle", value: "middle" },
            { label: "Right", value: "right" },
            { label: "Hidden", value: "hidden" },
        ],
        onChange: () => applyHeader(),
    },
    headerHash: { type: OptionType.BOOLEAN, description: "Servers: show the # / channel icon next to the name.", default: true, onChange: () => applyHeader() },
    headerFollow: { type: OptionType.BOOLEAN, description: "Servers: show the Follow button in announcement channels.", default: false, onChange: () => applyHeader() },
    headerButtons: {
        type: OptionType.SELECT,
        description: "Servers: header buttons position (pins, threads, notifications...).",
        options: [
            { label: "Left", value: "left", default: true },
            { label: "Middle", value: "middle" },
            { label: "Right", value: "right" },
        ],
        onChange: () => applyHeader(),
    },
    headerSearch: {
        type: OptionType.SELECT,
        description: "Servers: search bar position.",
        options: [
            { label: "Left", value: "left" },
            { label: "Middle", value: "middle" },
            { label: "Right", value: "right", default: true },
            { label: "Hidden", value: "hidden" },
        ],
        onChange: () => applyHeader(),
    },

    /* --- DM header --- */
    dmHeaderName: {
        type: OptionType.SELECT,
        description: "DMs: avatar + name position.",
        options: [
            { label: "Left", value: "left" },
            { label: "Middle", value: "middle" },
            { label: "Right", value: "right" },
            { label: "Hidden", value: "hidden", default: true },
        ],
        onChange: () => applyHeader(),
    },
    dmHeaderButtons: {
        type: OptionType.SELECT,
        description: "DMs: header buttons position (call, pins, add friend...).",
        options: [
            { label: "Left", value: "left", default: true },
            { label: "Middle", value: "middle" },
            { label: "Right", value: "right" },
        ],
        onChange: () => applyHeader(),
    },
    dmHeaderSearch: {
        type: OptionType.SELECT,
        description: "DMs: search bar position.",
        options: [
            { label: "Left", value: "left" },
            { label: "Middle", value: "middle" },
            { label: "Right", value: "right", default: true },
            { label: "Hidden", value: "hidden" },
        ],
        onChange: () => applyHeader(),
    },

    headerHiddenButtons: {
        type: OptionType.STRING,
        description: "Hide header buttons whose label contains any of these words (comma separated), e.g. Video, Pinned, Threads, Notification, Member List, User Profile, Inbox, Help.",
        default: "Video, User Profile, Member List, Threads, Inbox, Help",
        onChange: () => applyHeader(),
    },

    /* --- performance --- */
    lite: {
        type: OptionType.BOOLEAN,
        description: "Performance mode: no background animation, blur, pulsing badges or hover animations. Best for weak PCs and laptops on battery.",
        default: false,
        onChange: () => { applyAttrs(); applyDvd(); },
    },
    ultra: {
        type: OptionType.BOOLEAN,
        description: "Ultimate performance mode: everything from Performance mode, plus instant hover and menu changes, no blur anywhere, and every animation in Discord (spinners, badges, the bouncing logo) stops while Discord isn't in front. Discord looks the same, just lighter. Requested by BLOODHOUND CIGGA.",
        default: false,
        onChange: () => { applyAttrs(); applyLiquid(); applyDvd(); setPauseWhenUnfocused(settings.store.pauseUnfocused || settings.store.ultra); },
    },
    pauseUnfocused: {
        type: OptionType.BOOLEAN,
        description: "Pause the moving background, liquid glass and pulsing badges while Discord isn't the active window (e.g. while you play), so they take nothing from your game.",
        default: true,
        onChange: () => setPauseWhenUnfocused(settings.store.pauseUnfocused || settings.store.ultra),
    },

    /* --- chat bar & activities --- */
    chatTranslate: { type: OptionType.BOOLEAN, description: "Chat bar: Translate button.", default: true, onChange: () => applyChat() },
    chatGif: { type: OptionType.BOOLEAN, description: "Chat bar: GIF button (picker opens on GIFs).", default: true, onChange: () => applyChat() },
    chatEmoji: { type: OptionType.BOOLEAN, description: "Chat bar: Emoji button (picker opens on emojis).", default: false, onChange: () => applyChat() },
    chatSticker: { type: OptionType.BOOLEAN, description: "Chat bar: Sticker button.", default: false, onChange: () => applyChat() },
    chatGift: { type: OptionType.BOOLEAN, description: "Chat bar: Gift button.", default: false, onChange: () => applyChat() },
    chatApps: { type: OptionType.BOOLEAN, description: "Chat bar: Apps button.", default: false, onChange: () => applyChat() },
    chatOtherVencord: { type: OptionType.BOOLEAN, description: "Chat bar: other Vencord plugin buttons.", default: false, onChange: () => applyChat() },
    chatSides: {
        type: OptionType.SELECT,
        description: "Which side messages are on, in DMs and servers.",
        options: [
            { label: "All on the left (Discord)", value: "off", default: true },
            { label: "Mine right, others left", value: "mineRight" },
            { label: "Mine left, others right", value: "mineLeft" },
        ],
        onChange: () => applyAttrs(),
    },
    showActivities: {
        type: OptionType.BOOLEAN,
        description: "Show “Start an Activity” buttons and activity tiles (voice panel, call controls, call grid). Applies instantly.",
        default: false,
        onChange: () => applyAttrs(),
    },

    /* --- menus --- */
    hiddenMenuItems: {
        type: OptionType.STRING,
        description: "Hide these right-click items in EVERY menu (comma separated, exact label, case-insensitive).",
        default: "",
    },
    hiddenServerMenu: {
        type: OptionType.STRING,
        description: "Hide these items in the server right-click menu.",
        default: "Privacy Settings, View Permissions, Edit Per-server Profile",
    },
    hiddenUserMenu: {
        type: OptionType.STRING,
        description: "Hide these items in the user / DM right-click menu.",
        default: "Start a Call, Add Note, Apps",
    },

    /* --- translate --- */
    autoTranslate: {
        type: OptionType.BOOLEAN,
        description: "Auto-translate received messages to English (shown by the Translate plugin, keep it enabled). Privacy: message text is sent to Google Translate.",
        default: false,
    },
    keepLanguages: {
        type: OptionType.STRING,
        description: "Language codes never auto-translated. Google often detects Slovenian slang as Slovak (sk) or Croatian (hr); add them if needed.",
        default: "en, sl",
    },
});

/* ================= settings screen ================= */

// readable names in the settings screen (Vencord would otherwise title-case the keys, e.g. "Bg Media Dim")
const NAMES: Record<string, string> = {
    taskbarIcon: "Terono icon on the taskbar", avatarShape: "Profile pictures", namesEverywhere: "Name styles everywhere", searchTools: "Search tools", blockedButton: "Blocked button on the friends page", shareUsage: "Count me as a Terono user", autoUpdate: "Update automatically", autoUpdateCheck: "Notify about new versions", openKeybind: "Ctrl + 1 shortcut", bulkMode: "Bulk select with Ctrl", overlayShow: "Terono overlay", overlayKey: "Hotkey", overlayOpacity: "Opacity", overlayCorner: "Corner", overlayCompact: "Only who's talking", overlayToasts: "Messages", callAmbient: "Ambient mode", homeDoubleClick: "Double-click Home: read all",
    accentPreset: "Color preset", voice: "Voice & online", close: "Close button", minimize: "Minimize button", maximize: "Maximize button",
    cardPreset: "Card colors", cardFill: "Fill", cardColor: "Card color", cardColor2: "Gradient end", cardAngle: "Gradient angle", textColor: "Text color",
    customText: "Custom text color", customIcons: "Custom icon color",
    cardShape: "Corners", panels: "Panels", cardStyle: "Material", glassOpacity: "Glass opacity", glassBlur: "Glass blur",
    liquidColor: "Light color", liquidSpeed: "Flow speed",
    embedStyle: "Embed style", embedColor: "Embed color", embedColor2: "Gradient end", embedAngle: "Gradient angle", embedOpacity: "Glass opacity",
    cardMedia: "Picture or video", cardMediaUrl: "Link", cardMediaDim: "Card color over it",
    background: "Background", bgMediaSource: "Source", bgMediaUrl: "Link", bgMediaDim: "Darken",
    bgBase: "Base color", bgColor1: "Glow color 1", bgColor2: "Glow color 2",
    serverList: "Server list", serverListDirection: "Server order", channelsSide: "Channel list side", membersSide: "Member list side",
    roleCount: "Role count", roleCountCustom: "Custom role count",
    font: "Font", fontPicker: "Font", logoSource: "Logo source", logoUrl: "Logo link", logoSize: "Logo size",
    quickIcon: "Quick settings icon", loadingScreen: "Terono loading screens",
    headerName: "Channel name", headerHash: "# icon", headerButtons: "Buttons", headerSearch: "Search bar", headerFollow: "Follow button",
    dmHeaderName: "Name & avatar", dmHeaderButtons: "Buttons", dmHeaderSearch: "Search bar", headerHiddenButtons: "Hide buttons by name",
    chatTranslate: "Translate", chatGif: "GIF", chatEmoji: "Emoji", chatSticker: "Sticker", chatGift: "Gift", chatApps: "Apps", chatOtherVencord: "Other plugins' buttons",
    showActivities: "Show activities", chatSides: "Message sides",
    appBorder: "App border", borderColor: "Border color", borderColor2: "Gradient end", appBorderFile: "Frame picture", appBorderWidth: "Width",
    hiddenMenuItems: "In every menu", hiddenServerMenu: "In the server menu", hiddenUserMenu: "In user & DM menus",
    autoTranslate: "Auto-translate", keepLanguages: "Never translate", lite: "Performance mode", ultra: "Ultimate performance mode", pauseUnfocused: "Pause when Discord isn't in front",
    customSelection: "Custom selection color", dvd: "Bouncing logo", dvdFile: "Picture", dvdSize: "Size", dvdSpeed: "Speed",
};

// Only the screen shows in Vencord's own list; each option's "show only when…" rule moves to dzHidden, which the
// screen checks. Internal values (last version, last preset) are never shown.
for (const [key, def] of Object.entries(settings.def as Record<string, any>)) {
    if (key === "ui") continue;
    if (NAMES[key]) def.displayName = NAMES[key];
    // the group headings already say where ("In servers", "Chat bar buttons"), so drop that part of the description
    if (typeof def.description === "string") {
        const d = def.description.replace(/^(Servers|DMs|Chat bar): /, "");
        def.description = d.charAt(0).toUpperCase() + d.slice(1);
    }
    def.dzHidden = key === "lastVersion" || key === "presetId" ? true : def.hidden;
    def.hidden = true;
}

// Bulk changes (preset, profile, reset) remount the open screen so every control shows the new values.
let revision = 0;
const revisionListeners = new Set<(r: number) => void>();

export function refreshSettingsUi() {
    revision++;
    for (const l of revisionListeners) l(revision);
}

export function useSettingsRevision() {
    const [rev, setRev] = useState(revision);
    useEffect(() => {
        revisionListeners.add(setRev);
        return () => void revisionListeners.delete(setRev);
    }, []);
    return rev;
}

/* ================= apply (split so each change only touches what it needs) ================= */

const sheets: Record<"vars" | "logo" | "chat" | "header" | "hsl" | "font" | "media" | "darker" | "loading" | "embeds" | "liquid" | "motion" | "sides" | "border" | "ultra" | "dvd", HTMLStyleElement | null> = { vars: null, logo: null, chat: null, header: null, hsl: null, font: null, media: null, darker: null, loading: null, embeds: null, liquid: null, motion: null, sides: null, border: null, ultra: null, dvd: null };

function sheet(name: keyof typeof sheets, css: string) {
    let el = sheets[name];
    if (!el) {
        el = sheets[name] = document.createElement("style");
        el.id = `terono-${name}`;
        document.head.append(el);
    }
    if (el.textContent !== css) el.textContent = css;
}

const pick = (id: ColorKey) => {
    const v = preview[id] ?? settings.store[id];
    return HEX_RE.test(v) ? v : COLOR_DEFAULTS[id];
};

function cardAlpha(s: typeof settings.store) {
    if (cardActive) return Math.max(0, Number(s.cardMediaDim ?? 60));
    return s.cardStyle === "glass" || s.cardStyle === "liquid" ? Number(s.glassOpacity) || 60 : 100;
}

// html:root out-specifies the theme's :root defaults regardless of load order
export function applyVars() {
    const s = settings.store;
    const customCard = s.cardPreset === "custom";
    const preset = CARDS[s.cardPreset] ?? CARDS.dark;
    const card = customCard ? pick("cardColor") : preset.card;
    const [xs, sm, md, lg, xl] = RADII[s.cardShape] ?? RADII.curved;

    sheet("vars", `html:root {
    --dz-accent: ${preview.accent ?? (s.accentPreset === "custom" ? pick("accent") : ACCENTS[s.accentPreset] ?? ACCENTS.blue)};
    --dz-voice: ${pick("voice")};
    --dz-close: ${pick("close")};
    --dz-minimize: ${pick("minimize")};
    --dz-maximize: ${pick("maximize")};
    --dz-card: ${card};
    --dz-card-2: ${customCard && s.cardFill === "gradient" ? pick("cardColor2") : card};
    --dz-card-angle: ${Number(s.cardAngle) || 0}deg;
    --dz-text: ${s.customText ? pick("textColor") : preset.text};
    --dz-card-alpha: ${cardAlpha(s)}%;
    --dz-float-alpha: ${cardAlpha(s) < 100 ? Math.min(95, cardAlpha(s) + 20) : 100}%;
    --dz-bg-dim: ${(Number(s.bgMediaDim) || 0) / 100};
    --dz-bg-base: ${pick("bgBase")};
    --dz-bg-1: ${pick("bgColor1")};
    --dz-bg-2: ${pick("bgColor2")};
    --radius-xs: ${xs}px;
    --radius-sm: ${sm}px;
    --radius-md: ${md}px;
    --radius-lg: ${lg}px;
    --radius-xl: ${xl}px;
    --dz-logo-size: ${Number(s.logoSize) || 72}%;
    --dz-embed-1: ${pick("embedColor")};
    --dz-embed-2: ${s.embedStyle === "gradient" ? pick("embedColor2") : pick("embedColor")};
    --dz-embed-angle: ${Number(s.embedAngle) || 0}deg;
    --dz-embed-alpha: ${Number(s.embedOpacity) || 40}%;
}${embedText(s)}${s.customIcons ? iconVars(pick("iconColor")) : ""}${s.customSelection ? selectionCss(pick("selectionColor")) : ""}`);
}

function selectionCss(c: string) {
    const text = luminance(c) > 0.4 ? "#111214" : "#ffffff";
    return `
html:root::selection, html:root .highlight { background: ${c} !important; color: ${text} !important; }`;
}

// Solid / gradient embeds: text dark or light, whichever reads better on the chosen colors
function luminance(hex: string) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function embedText(s: typeof settings.store) {
    if (s.embedStyle !== "solid" && s.embedStyle !== "gradient") return "";
    const l = (luminance(pick("embedColor")) + luminance(s.embedStyle === "gradient" ? pick("embedColor2") : pick("embedColor"))) / 2;
    const [text, muted] = l > 0.4 ? ["#111214", "#3c3f45"] : ["#f2f3f5", "#b5bac1"];
    return `
html[data-dz-embed] ${EMBED} {
    --text-default: ${text}; --text-normal: ${text}; --text-strong: ${text}; --header-primary: ${text}; --interactive-text-default: ${text};
    --text-muted: ${muted}; --text-subtle: ${muted}; --header-secondary: ${muted};${l > 0.4 ? " --text-link: #0b57d0;" : ""}
    color: ${text};
}`;
}

// Icons get their color from about ten different variables, several of which also color text, so the icons
// themselves are recolored: every icon drawn in "currentColor", except inside filled buttons (white on color),
// server folders (their own color) and anything with a color set on the icon itself. The variables still
// cover icons drawn by CSS.
const ICON_SKIP = [
    ".primary_a22cb0", ".critical-primary_a22cb0", ".active_a22cb0", ".expressive_a22cb0", ".overlay-primary_a22cb0",
    "[class*=colorBrand]", "[class*=colorGreen]", "[class*=colorRed]", "[class*=lookFilled]",
    "[class*=colorDanger]", "[class*=colorPremium]", "[class*=folderIcon]", "[class*=expandedFolderIconWrapper]", ".vc-switch-container", ".dz-pv",
].join(", ");
const ICON = `svg:not([style*="color"], :is(${ICON_SKIP}) svg)`;

function iconVars(c: string) {
    const up = (n: number) => `color-mix(in srgb, ${c}, var(--dz-text) ${n}%)`;
    return `
html body, html .theme-dark:not(.custom-user-profile-theme), html .theme-light:not(.custom-user-profile-theme), html :is(.theme-darker, .theme-midnight) {
    --interactive-icon-default: ${c};
    --interactive-icon-hover: ${up(35)};
    --interactive-icon-active: ${up(50)};
    --icon-default: ${c};
    --icon-subtle: ${c};
    --icon-muted: color-mix(in srgb, ${c} 70%, var(--dz-card));
    --icon-strong: ${up(35)};
    --channel-icon: ${c};
}
html[data-dz-plugin] ${ICON} {
    color: ${c};
}
html[data-dz-plugin] :is(button, a, [role=button], [role=tab], [role=menuitem], [role=link], [role=treeitem]):hover ${ICON},
html[data-dz-plugin] :is([aria-selected=true], [aria-checked=true], [aria-pressed=true], [aria-current=page]) ${ICON} {
    color: ${up(45)};
}`;
}

export function applyLogo() {
    const s = settings.store;
    const url = s.logoSource === "file" && uploadedLogo ? uploadedLogo
        : URL_RE.test(s.logoUrl) ? s.logoUrl : DEFAULT_LOGO;
    sheet("logo", `html:root { --dz-home-logo: url("${url}"); --dz-quick-icon: url("${TERONO_LOGO}"); }`);
}

/* ---------- "connecting" screen: Terono logo + name instead of Discord's spinner video ----------
   Bundled (no network) so it's there on the first frame after start. The video stays in the page, just
   invisible: Discord waits for it to load before it fades the screen out. */

export function applyLoading() {
    sheet("loading", !settings.store.loadingScreen ? "" : `
html .container_a2f514 {
    background: radial-gradient(60% 50% at 50% 40%, color-mix(in srgb, var(--dz-accent) 22%, transparent), transparent 70%), var(--dz-bg-base) !important;
}
html .container_a2f514 .spinner_a2f514 {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    opacity: 0 !important;
    pointer-events: none;
}
html .container_a2f514 .content_a2f514::before {
    content: "Terono Discord";
    display: block;
    padding-top: 168px;
    margin-bottom: 28px;
    background: url("${TERONO_LOGO}") top center / 144px 144px no-repeat;
    color: var(--dz-text);
    font: 800 28px/1.2 var(--font, "Figtree"), sans-serif;
    letter-spacing: 0.02em;
    text-align: center;
    animation: dz-loading-float 2.4s ease-in-out infinite;
}
html .container_a2f514 .tipTitle_a2f514 {
    color: var(--dz-accent) !important;
}
@keyframes dz-loading-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
}
@media (prefers-reduced-motion: reduce) {
    html .container_a2f514 .content_a2f514::before { animation: none; }
}`);
}

const CHAT_BUTTONS: [string, string][] = [
    ["chatTranslate", ':has([aria-label="Open Translate Modal"])'],
    ["chatGif", ':has([aria-label="Open GIF picker"])'],
    ["chatEmoji", ":has(.emojiButton__74017)"],
    ["chatSticker", ":has(.stickerButton__74017)"],
    ["chatGift", ':has([aria-label="Send a gift"])'],
    ["chatApps", ".app-launcher-entrypoint"],
    ["chatOtherVencord", '.vc-chatbar-button:not(:has([aria-label="Open Translate Modal"]))'],
];

export function applyChat() {
    const s = settings.store as Record<string, unknown>;
    const visible = CHAT_BUTTONS.filter(([key]) => s[key]).map(([, sel]) => sel);
    const target = visible.length ? `.buttons__74017 > :not(${visible.join(", ")})` : ".buttons__74017 > *";
    sheet("chat", `html[data-dz-plugin] ${target} { display: none !important; }`);
}

const ZONE: Record<string, number> = { left: 1, middle: 3, right: 5 };
const cssString = (v: string) => v.replace(/["\\\n\r]/g, "");

export function applyHeader() {
    const s = settings.store;
    const words = s.headerHiddenButtons.split(",").map(w => cssString(w.trim())).filter(Boolean).slice(0, 30);
    const serverHide = [
        s.headerName === "hidden" && ".title_f75fb0 .children__9293f",
        s.headerSearch === "hidden" && '.title_f75fb0 .toolbar__9293f > [class*="search_"]',
        !s.headerHash && ".title_f75fb0 .children__9293f > .iconWrapper__9293f",
        !s.headerFollow && ".title_f75fb0 .followButton_f75fb0",
    ].filter(Boolean).map(sel => `html:not([data-dz-dm]) ${sel}`);
    const dmHide = [
        s.dmHeaderName === "hidden" && ".title_f75fb0 .children__9293f",
        s.dmHeaderSearch === "hidden" && '.title_f75fb0 .toolbar__9293f > [class*="search_"]',
    ].filter(Boolean).map(sel => `html[data-dz-dm] ${sel}`);
    const hide = [...words.map(w => `.title_f75fb0 .toolbar__9293f > [aria-label*="${w}" i]`), ...serverHide, ...dmHide];

    sheet("header", `html:root {
    --dz-h-name: ${ZONE[s.headerName] ?? 1};
    --dz-h-buttons: ${ZONE[s.headerButtons] ?? 1};
    --dz-h-search: ${ZONE[s.headerSearch] ?? 5};
}
html[data-dz-dm]:root {
    --dz-h-name: ${ZONE[s.dmHeaderName] ?? 1};
    --dz-h-buttons: ${ZONE[s.dmHeaderButtons] ?? 1};
    --dz-h-search: ${ZONE[s.dmHeaderSearch] ?? 5};
}${hide.length ? `\n${hide.join(",\n")} { display: none !important; }` : ""}`);

    requestAnimationFrame(attachHeader);
}

// attributes, not classes: Discord rewrites <html class> on theme changes
export function applyAttrs() {
    const s = settings.store;
    const d = document.documentElement.dataset;
    const flag = (key: string, on: boolean) => { if (on) d[key] = ""; else delete d[key]; };

    d.dzPlugin = "";
    d.dzBg = s.background;
    d.dzCardFill = s.cardPreset === "custom" ? s.cardFill : "solid";
    d.dzGuilds = s.serverList;
    d.dzChannels = s.channelsSide;
    d.dzMembers = s.membersSide;
    flag("dzNames", s.namesEverywhere);
    if (s.avatarShape && s.avatarShape !== "circle") d.dzAvatars = s.avatarShape;
    else delete d.dzAvatars;
    if (s.panels === "discord") d.dzPanels = "discord";
    else delete d.dzPanels;
    flag("dzGlass", s.cardStyle === "glass" || s.cardStyle === "liquid" || cardActive);
    flag("dzCardMedia", cardActive);
    flag("dzGlassBlur", (s.cardStyle === "glass" || s.cardStyle === "liquid") && s.glassBlur);
    flag("dzLiquid", s.cardStyle === "liquid");
    if (s.embedStyle && s.embedStyle !== "cards") d.dzEmbed = s.embedStyle;
    else delete d.dzEmbed;
    sheet("embeds", EMBED_CSS);
    // chat sides: Vencord's ThemeAttributes marks your own messages (data-is-self); flipping a message's direction
    // mirrors Discord's layout (avatar, spacing), the text itself stays left-to-right
    if (s.chatSides === "mineRight" || s.chatSides === "mineLeft") d.dzChat = s.chatSides;
    else delete d.dzChat;
    sheet("sides", SIDES_CSS);
    applyBorder();
    sheet("motion", MOTION_CSS);
    applyDrift();
    flag("dzActivities", s.showActivities);
    flag("dzLite", s.lite || s.ultra);
    flag("dzUltra", s.ultra);
    sheet("ultra", s.ultra ? ULTRA_CSS : "");
    flag("dzQuick", s.quickIcon);

    // bundled, so the horizontal list is there on the very first frame (no network fetch, no flash)
    const horizontal = s.serverList === "top" || s.serverList === "bottom";
    // Right to left: the list keeps the normal (scrollable) order and is mirrored along its length instead of being
    // laid out in reverse. A reversed flex column with end alignment pushed the first servers past the edge that
    // can't be scrolled to, so the list wouldn't scroll. Each icon is mirrored back so it stays upright.
    const rtl = horizontal && s.serverListDirection === "rtl"
        ? "\n.guilds__5e434 .scroller_ef3116 { scale: 1 -1; }\n.guilds__5e434 :is(.wrapper__6e9f8, .folderPreview__48112, .folderIconWrapper__48112, .lowerBadge_cc5dd2, .upperBadge_cc5dd2) { scale: -1 1; }"
        : "";
    sheet("hsl", !horizontal ? "" : HSL_CSS + (s.serverList === "bottom" ? "\n" + HSL_BOTTOM_CSS : "") + rtl);
}

/* ---------- fonts ---------- */

export const fontStack = (key: string) => {
    const family = key === "custom" ? (customFont ? "Terono Custom" : "") : FONTS[key];
    return family ? `"${family}", "gg sans", sans-serif` : '"gg sans", sans-serif';
};

// the font dropdown draws every name in its font: one small request with only the letters of the names
let previewLink: HTMLLinkElement | null = null;
export function loadFontPreviews() {
    if (previewLink?.isConnected) return;
    const families = Object.values(FONTS).filter(Boolean);
    const text = [...new Set(families.join("") + "Terono()Custom uploadDiscordgs The quick brown fox 123")].sort().join("");
    previewLink = document.head.appendChild(document.createElement("link"));
    previewLink.rel = "stylesheet";
    previewLink.href = `https://fonts.googleapis.com/css2?${families.map(f => `family=${encodeURIComponent(f)}:wght@500`).join("&")}&text=${encodeURIComponent(text)}&display=swap`;
}

let fontLink: HTMLLinkElement | null = null;

export function applyFont() {
    const key = settings.store.font;
    const family = key === "custom" ? (customFont ? "Terono Custom" : "") : FONTS[key] ?? "Figtree";

    const needsLink = key !== "custom" && key !== "discord" && key !== "terono" && family;
    if (needsLink) {
        const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700;800&display=swap`;
        fontLink ??= document.head.appendChild(document.createElement("link"));
        fontLink.rel = "stylesheet";
        if (fontLink.href !== href) fontLink.href = href;
    } else {
        fontLink?.remove();
        fontLink = null;
    }

    sheet("font", family ? `html body { --font: "${family}"; }` : 'html body { --font: "gg sans"; }');
}

/* ---------- background image / gif / video ---------- */

let videoEl: HTMLVideoElement | null = null;
let bgObserver: MutationObserver | null = null;
const VIDEO_RE = /\.(mp4|webm|mov)(\?|#|$)/i;
const probed = new Map<string, "image" | "video" | "fail" | "pending">();
const probeTimers = new Map<string, number>();

// A link is checked once typing stops (no error for every half-typed link) and shows as soon as it loads.
// A link that failed is tried again later (its site may have been allowed since).
function probeUrl(url: string) {
    const known = probed.get(url);
    if (known) return known;
    probed.set(url, "pending");
    clearTimeout(probeTimers.get(url));
    probeTimers.set(url, window.setTimeout(() => { probeTimers.delete(url); startProbe(url); }, 400));
    return "pending";
}

function startProbe(url: string) {
    const s = settings.store;
    // typed further in the meantime: forget this one
    if (url !== s.bgMediaUrl && url !== s.cardMediaUrl) return void probed.delete(url);

    const done = (kind: "image" | "video" | "fail") => {
        probed.set(url, kind);
        if (kind === "fail") {
            toast("Image / video couldn't be loaded: not a direct image/video link, or its site isn't allowed by Vencord.", "failure");
            setTimeout(() => probed.get(url) === "fail" && probed.delete(url), 15_000);
        }
        applyMedia();
        applyCardMedia();
    };
    const tryVideo = () => {
        const v = document.createElement("video");
        v.muted = true;
        v.preload = "metadata";
        v.onloadedmetadata = () => done("video");
        v.onerror = () => done("fail");
        v.src = url;
    };
    if (VIDEO_RE.test(url)) return tryVideo();

    const img = new Image();
    img.onload = () => done("image");
    img.onerror = tryVideo;
    img.src = url;
}

function attachVideo() {
    const bg = document.querySelector("#app-mount .bg__960e4");
    if (bg && videoEl && videoEl.parentElement !== bg) bg.prepend(videoEl);
}

function onVisibility() {
    for (const v of [videoEl, cardLayer?.querySelector("video")]) {
        if (!v) continue;
        if (document.hidden) v.pause();
        else v.play().catch(() => { });
    }
    updateCardClip();
}

/* ---------- card image / GIF / video ----------
   One full-window layer right above the app background, clipped to the outline of every panel, so the media
   runs across all panels as one picture (like the gradient fill) and stays out of the gaps between them. */

const CARD_SEL = [
    ".guilds__5e434", ".sidebarList__5e434", ".panels__5e434", ".chat_f75fb0 > .subtitleContainer_f75fb0", ".chatContent_f75fb0",
    ".container_c8ffbb", ".container__133bf > .container__9293f", ".peopleColumn__133bf", ".nowPlayingColumn__133bf",
    ".searchResultsWrap_a98f3b", ".container_f369db", ".chat_fb64c9", ".callContainer_cb9592", ".container_f391e3 > .content_f75fb0",
    ".shop__6db1d", ".content_f75fb0 > aside > .outer_c0bea0:not(.custom-theme-background)",
].join(",");

// a newly chosen file needs a new object URL (the old one would keep showing the previous file)
function dropObjectUrl(which: "bg" | "card") {
    if (which === "bg" && mediaUrl) {
        URL.revokeObjectURL(mediaUrl);
        mediaUrl = null;
    }
    if (which === "card" && cardUrl) {
        URL.revokeObjectURL(cardUrl);
        cardUrl = null;
    }
}

let cardActive = false;
let cardLayer: HTMLDivElement | null = null;
let cardUrl: string | null = null;
let stopCardWatch: (() => void) | null = null;
let cardPath = "";

// outline of every panel as one SVG path, relative to `base`
function panelOutline(base: DOMRect) {
    const n = (v: number) => Math.round(v * 10) / 10;
    let d = "";
    for (const el of document.querySelectorAll<HTMLElement>(CARD_SEL)) {
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        const x = n(b.left - base.left), y = n(b.top - base.top), w = n(b.width), h = n(b.height);
        const r = n(Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2));
        // clockwise rounded rect; same winding everywhere so overlapping panels add up instead of cutting holes
        d += `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
            + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    }
    return d;
}

// Panels move with the layout (channel switches, member list, resizing); their outline is re-read twice a second
// when the browser is idle, so it never forces an extra layout in the middle of Discord's own work
function watchOutline(update: () => void) {
    const check = () => {
        if (isAway()) return;
        if ("requestIdleCallback" in window) requestIdleCallback(update, { timeout: 500 });
        else update();
    };
    const timer = window.setInterval(check, 500);
    window.addEventListener("resize", update);
    window.addEventListener("focus", update);
    return () => {
        clearInterval(timer);
        window.removeEventListener("resize", update);
        window.removeEventListener("focus", update);
    };
}

function updateCardClip() {
    if (!cardLayer) return;
    const bg = document.querySelector("#app-mount .bg__960e4");
    if (bg && cardLayer.previousElementSibling !== bg) bg.after(cardLayer);
    if (document.hidden) return;
    const d = panelOutline(cardLayer.getBoundingClientRect());
    if (d === cardPath) return;
    cardPath = d;
    cardLayer.style.clipPath = d ? `path("${d}")` : "inset(50%)";
}

function removeCardLayer() {
    cardLayer?.remove();
    cardLayer = null;
    cardPath = "";
    stopCardWatch?.();
    stopCardWatch = null;
}

export function applyCardMedia() {
    const s = settings.store;
    const fromFile = s.cardMedia === "file";

    if (cardUrl && !(fromFile && cardBlob)) {
        URL.revokeObjectURL(cardUrl);
        cardUrl = null;
    }
    let src = "";
    let isVideo = false;
    if (fromFile && cardBlob) {
        cardUrl ??= URL.createObjectURL(cardBlob);
        src = cardUrl;
        isVideo = cardBlob.type.startsWith("video/");
    } else if (s.cardMedia === "url" && URL_RE.test(s.cardMediaUrl)) {
        const kind = probeUrl(s.cardMediaUrl);
        if (kind === "image" || kind === "video") {
            src = s.cardMediaUrl;
            isVideo = kind === "video";
        }
    }

    // panels only turn see-through once there is something to show in them
    if (!!src !== cardActive) {
        cardActive = !!src;
        applyAttrs();
        applyVars();
    }
    if (!src) return removeCardLayer();

    if (!cardLayer) {
        cardLayer = document.createElement("div");
        cardLayer.className = "dz-card-media";
        cardLayer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;clip-path:inset(50%)";
        stopCardWatch = watchOutline(updateCardClip);
        document.addEventListener("visibilitychange", onVisibility);
    }
    let media = cardLayer.firstElementChild as HTMLImageElement | HTMLVideoElement | null;
    if (media?.tagName !== (isVideo ? "VIDEO" : "IMG")) {
        media?.remove();
        media = document.createElement(isVideo ? "video" : "img");
        if (media instanceof HTMLVideoElement) Object.assign(media, { muted: true, defaultMuted: true, volume: 0, loop: true, autoplay: true, playsInline: true, disableRemotePlayback: true });
        else Object.assign(media, { alt: "", decoding: "async" });
        media.style.cssText = "display:block;width:100%;height:100%;object-fit:cover";
        cardLayer.append(media);
    }
    if (media.src !== src) media.src = src;
    if (media instanceof HTMLVideoElement) media.play().catch(() => { });
    updateCardClip();
}

/* ---------- chat sides ---------- */

const SIDE = (self: boolean) => `:is(li[data-is-self="${self}"], .message__5126c[data-is-self="${self}"])`;
const flip = (mode: string, self: boolean) => `
html[data-dz-chat="${mode}"] ${SIDE(self)}:is(.message__5126c), html[data-dz-chat="${mode}"] ${SIDE(self)} .message__5126c { direction: rtl; }
html[data-dz-chat="${mode}"] ${SIDE(self)} :is([id^="message-content"], [id^="message-accessories"] > *, [class*="repliedMessage_"], [class*="username_"], [class*="botTag"], time, [class*="threadMessageAccessory"]) { direction: ltr; }
html[data-dz-chat="${mode}"] ${SIDE(self)} [id^="message-content"] { text-align: right; }`;
const SIDES_CSS = flip("mineRight", true) + flip("mineLeft", false);

/* ---------- app border ---------- */

export function applyBorder() {
    const s = settings.store;
    const w = Math.max(1, Math.min(12, Number(s.appBorderWidth) || 3));
    const fill = s.appBorder === "color" ? pick("borderColor")
        : s.appBorder === "gradient" ? `linear-gradient(135deg, ${pick("borderColor")}, ${pick("borderColor2")})`
            : s.appBorder === "image" && borderUrl ? `url("${borderUrl}") center / 100% 100%` : "";
    // a ring: the fill masked to the frame only, above everything, never catching the mouse
    sheet("border", !fill ? "" : `
#app-mount::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    pointer-events: none;
    padding: ${w}px;
    border-radius: var(--radius-lg, 12px);
    background: ${fill};
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
}`);
}

/* ---------- ultimate performance mode ----------
   On top of Performance mode: changes on hover and in menus happen at once instead of animating (a 1 ms
   transition, so code waiting for a transition to end still gets told), nothing is blurred behind (blur is redone
   on every change underneath), and while Discord isn't in front every CSS animation in it holds still. */
const ULTRA_CSS = `
html[data-dz-ultra] *, html[data-dz-ultra] *::before, html[data-dz-ultra] *::after {
    transition-duration: 1ms !important;
    transition-delay: 0s !important;
    backdrop-filter: none !important;
}
html[data-dz-ultra][data-dz-away] *, html[data-dz-ultra][data-dz-away] *::before, html[data-dz-ultra][data-dz-away] *::after {
    animation-play-state: paused !important;
}`;

/* ---------- embeds ---------- */

const EMBED = ":is(.embedFull__623de, article[class*=embedFull_])";
const EMBED_CSS = `
html[data-dz-embed="solid"] ${EMBED}, html[data-dz-embed="gradient"] ${EMBED} {
    background: linear-gradient(var(--dz-embed-angle), var(--dz-embed-1), var(--dz-embed-2)) !important;
}
html[data-dz-embed="glass"] ${EMBED} {
    background: color-mix(in srgb, var(--dz-embed-1) var(--dz-embed-alpha), transparent) !important;
    backdrop-filter: blur(14px) saturate(1.3);
}
html[data-dz-lite][data-dz-embed="glass"] ${EMBED} {
    backdrop-filter: none;
}`;

/* ---------- liquid glass ----------
   See-through panels with soft light flowing under them: a layer right above the app background, clipped to the
   panel outlines, holding a few large soft color spots. They're moved by the shared 30-per-second clock (motion.ts)
   with plain transforms: no blur filter, no blend mode, no CSS animation at the monitor's refresh rate. With glass
   blur on, the panels blur the light too. */

const LIQUID_SPEED: Record<string, number> = { slow: 1, medium: 1.7, fast: 2.8 };
let liquidLayer: HTMLDivElement | null = null;
let stopLiquidWatch: (() => void) | null = null;
let liquidPath = "";
let liquidSpeed = 1;
let liquidW = innerWidth;
let liquidH = innerHeight;

// each spot drifts on its own slow looping path (periods in seconds at "slow")
const SPOTS: [periodX: number, periodY: number, phase: number, size: number][] = [
    [47, 61, 0, 0.85],
    [59, 43, 2.1, 0.75],
    [67, 53, 4.2, 0.95],
];

function liquidTick(t: number) {
    if (!liquidLayer) return;
    const spots = liquidLayer.children;
    const tau = Math.PI * 2 * liquidSpeed;
    for (let i = 0; i < SPOTS.length; i++) {
        const [px, py, ph] = SPOTS[i];
        const x = liquidW * (0.5 + 0.42 * Math.sin(t * tau / px + ph));
        const y = liquidH * (0.5 + 0.42 * Math.sin(t * tau / py + ph * 1.7));
        (spots[i] as HTMLElement).style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
    // a soft light band sweeping across now and then
    const sweep = (t * liquidSpeed / 26) % 1;
    (spots[SPOTS.length] as HTMLElement).style.transform = `translate3d(${((sweep * 1.6 - 0.3) * liquidW).toFixed(1)}px, 0, 0) rotate(12deg)`;
}

function updateLiquidClip() {
    if (!liquidLayer) return;
    const bg = document.querySelector("#app-mount .bg__960e4");
    // right above the background (and the card picture, if any), under the panels
    const after = cardLayer ?? bg;
    if (after && liquidLayer.previousElementSibling !== after) after.after(liquidLayer);
    if (document.hidden) return;
    liquidW = innerWidth;
    liquidH = innerHeight;
    const d = panelOutline(liquidLayer.getBoundingClientRect());
    if (d === liquidPath) return;
    liquidPath = d;
    liquidLayer.style.clipPath = d ? `path("${d}")` : "inset(50%)";
}

function removeLiquid() {
    removeTicker(liquidTick);
    stopLiquidWatch?.();
    stopLiquidWatch = null;
    liquidLayer?.remove();
    liquidLayer = null;
    liquidPath = "";
    sheet("liquid", "");
}

export function applyLiquid() {
    const s = settings.store;
    if (s.cardStyle !== "liquid") return removeLiquid();

    liquidSpeed = LIQUID_SPEED[s.liquidSpeed] ?? 1;
    const white = s.liquidColor === "white";
    const colors = white ? ["#ffffff", "#ffffff", "#ffffff"] : ["var(--dz-accent)", "var(--dz-bg-1)", "var(--dz-bg-2)"];
    const size = Math.round(Math.max(innerWidth, innerHeight) * 0.9);
    sheet("liquid", `
.dz-liquid { position: absolute; inset: 0; overflow: hidden; pointer-events: none; clip-path: inset(50%); contain: strict; }
.dz-liquid i { position: absolute; left: 0; top: 0; border-radius: 50%; will-change: transform; transition: transform ${MOTION_STEP_MS}ms linear; }
${SPOTS.map(([, , , k], i) => `.dz-liquid i:nth-child(${i + 1}) { width: ${Math.round(size * k)}px; height: ${Math.round(size * k)}px; margin: ${-Math.round(size * k / 2)}px 0 0 ${-Math.round(size * k / 2)}px;
    background: radial-gradient(circle closest-side, color-mix(in srgb, ${colors[i]} ${white ? 22 : 55}%, transparent), transparent); }`).join("\n")}
.dz-liquid i:last-child { width: ${Math.round(size * 0.35)}px; height: 300vh; top: -100vh; border-radius: 0;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / ${white ? 7 : 5}%), transparent); }`);

    if (!liquidLayer) {
        liquidLayer = document.createElement("div");
        liquidLayer.className = "dz-liquid";
        liquidLayer.setAttribute("aria-hidden", "true");
        liquidLayer.innerHTML = "<i></i>".repeat(SPOTS.length + 1);
        stopLiquidWatch = watchOutline(updateLiquidClip);
    }
    // measuring the panels forces a layout: wait for the next frame instead of doing it while Discord starts
    requestAnimationFrame(updateLiquidClip);
    // Performance mode or "Still": the light stays where it is
    if (s.lite || s.ultra || s.liquidSpeed === "still") {
        removeTicker(liquidTick);
        liquidTick(12);
    } else addTicker(liquidTick);
}

/* ---------- background drift ----------
   The animated background's slow drift, from the shared clock instead of a CSS animation (see motion.ts). The theme
   keeps it still with glass blur (re-blurring a moving background is expensive), in performance mode and for
   static / solid / picture backgrounds; the same rules apply here. */

let driftEl: HTMLElement | null = null;

function driftTick(t: number) {
    if (!driftEl?.isConnected) driftEl = document.querySelector<HTMLElement>("#app-mount .bg__960e4");
    if (!driftEl) return;
    // the same path as the old animation: corner to corner and back, once a minute
    const k = -Math.cos(t * Math.PI * 2 / 60);
    driftEl.style.setProperty("--dz-dx", `${(5 * k).toFixed(3)}%`);
    driftEl.style.setProperty("--dz-dy", `${(4 * k).toFixed(3)}%`);
}

function applyDrift() {
    const s = settings.store;
    const glassBlur = (s.cardStyle === "glass" || s.cardStyle === "liquid") && s.glassBlur;
    if (s.background === "animated" && !s.lite && !s.ultra && !glassBlur) addTicker(driftTick);
    else removeTicker(driftTick);
}

// the theme's CSS animations for these are replaced (drift) or limited (badges pulse a few times, then glow)
const MOTION_CSS = `
html[data-dz-plugin] #app-mount .bg__960e4::before {
    animation: none !important;
    transform: translate3d(var(--dz-dx, 0%), var(--dz-dy, 0%), 0);
    transition: transform ${MOTION_STEP_MS}ms linear;
}
html[data-dz-plugin] .numberBadge__463b7,
html[data-dz-plugin] .listItem__650eb::after {
    animation-iteration-count: 5 !important;
}
html[data-dz-away] :is(.numberBadge__463b7, [data-dz-creator], [data-dz-vroca]),
html[data-dz-away] .listItem__650eb::after {
    animation-play-state: paused !important;
}`;

export function applyMedia() {
    const s = settings.store;
    const active = s.background === "media";
    const fromFile = s.bgMediaSource === "file";

    if (mediaUrl && (!active || !fromFile)) {
        URL.revokeObjectURL(mediaUrl);
        mediaUrl = null;
    }
    let src = "";
    let isVideo = false;
    if (active && fromFile && mediaBlob) {
        mediaUrl ??= URL.createObjectURL(mediaBlob);
        src = mediaUrl;
        isVideo = mediaBlob.type.startsWith("video/");
    } else if (active && !fromFile && URL_RE.test(s.bgMediaUrl)) {
        const kind = probeUrl(s.bgMediaUrl);
        if (kind === "image" || kind === "video") {
            src = s.bgMediaUrl;
            isVideo = kind === "video";
        }
    }

    // nothing usable (no file yet, loading, or failed): show the static gradient instead of a blank background
    const d = document.documentElement.dataset;
    if (active) d.dzBg = src ? "media" : "static";

    if (isVideo && src) {
        if (!videoEl) {
            videoEl = document.createElement("video");
            videoEl.className = "dz-bg-video";
            videoEl.onerror = () => {
                if (!videoEl?.src.startsWith("blob:")) probed.set(videoEl!.src, "fail");
                toast("Background video couldn't be played.", "failure");
            };
            Object.assign(videoEl, { muted: true, defaultMuted: true, volume: 0, loop: true, autoplay: true, playsInline: true, disableRemotePlayback: true });
            document.addEventListener("visibilitychange", onVisibility);
            bgObserver = new MutationObserver(attachVideo);
            const layer = document.querySelector("#app-mount .bg__960e4")?.parentElement;
            if (layer) bgObserver.observe(layer, { childList: true });
        }
        if (videoEl.src !== src) videoEl.src = src;
        attachVideo();
        videoEl.play().catch(() => { });
        sheet("media", "");
    } else {
        videoEl?.remove();
        videoEl = null;
        bgObserver?.disconnect();
        bgObserver = null;
        document.removeEventListener("visibilitychange", onVisibility);
        sheet("media", src ? `html:root { --dz-bg-media: url("${src}"); }` : "");
    }
}

/* ---------- popups Discord paints with its own "darker"/"midnight" palette ----------
   Neither Midnight nor this theme target those classes, so such popups (e.g. the screenshare
   picker) fell back to stock Discord colors. Make their custom properties inherit ours instead. */

// reading every rule of Discord's stylesheets takes ~30 ms: the result is kept per Discord build (its CSS file names)
const DARKER_KEY = "Terono_darkerPalette";

export function applyDarkerPalette() {
    const build = [...document.styleSheets].map(s => s.href ?? "").filter(h => h.includes("discord")).join("|");
    try {
        const saved = JSON.parse(localStorage.getItem(DARKER_KEY) ?? "null");
        if (build && saved?.build === build) return sheet("darker", saved.css);
    } catch { /* recompute */ }
    const props = new Set<string>();
    for (const sheetObj of document.styleSheets) {
        let rules: CSSRuleList;
        try { rules = sheetObj.cssRules; } catch { continue; }
        for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule) || !/^\.theme-(darker|midnight)$/.test(rule.selectorText)) continue;
            for (const name of rule.style) if (name.startsWith("--")) props.add(name);
        }
    }
    const decl = [...props].map(p => `${p}: inherit;`).join("");
    const css = decl ? `html :is(.theme-darker, .theme-midnight):not(html) { ${decl} }` : "";
    sheet("darker", css);
    if (build) try { localStorage.setItem(DARKER_KEY, JSON.stringify({ build, css })); } catch { /* full storage: recompute next time */ }
}

/* ---------- overlay (the main process does it) ---------- */

let lastOverlay = "";
export const forgetOverlay = () => { lastOverlay = ""; };

// the overlay is drawn in your Terono look: panel color, glass, accent, text, corners and font
function overlayTheme() {
    const root = getComputedStyle(document.documentElement);
    const v = (k: string) => root.getPropertyValue(k).trim();
    const key = settings.store.font;
    const family = key === "custom" || key === "discord" ? "" : FONTS[key] ?? "Figtree";
    return {
        accent: v("--dz-accent"),
        panel: v("--dz-card"),
        text: v("--dz-text"),
        radius: v("--radius-lg"),
        glass: document.documentElement.hasAttribute("data-dz-glass"),
        font: family,
        fontHref: family ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@500;600;700;800&display=swap` : "",
    };
}
// reading the theme forces a style calculation: done once things have settled, and once for a burst of changes
let overlayTimer = 0;
export function applyOverlay() {
    if (!IS_DISCORD_DESKTOP) return;
    clearTimeout(overlayTimer);
    overlayTimer = window.setTimeout(applyOverlayNow, 400);
}

function applyOverlayNow() {
    syncOverlay();
    const s = settings.store;
    const cfg = {
        show: (s.overlayShow ?? "on") as "on" | "hotkey" | "off",
        key: s.overlayKey ?? "",
        corner: s.overlayCorner ?? "top-left",
        opacity: (Number(s.overlayOpacity) || 100) / 100,
        accent: getComputedStyle(document.documentElement).getPropertyValue("--dz-accent").trim() || "#429cff",
        compact: !!s.overlayCompact,
        theme: overlayTheme(),
    };
    const key = JSON.stringify(cfg);
    if (key === lastOverlay) return;
    lastOverlay = key;
    const Native = VencordNative.pluginHelpers.Terono as PluginNative<typeof import("./native")>;
    Native.overlayConfig(cfg).then(ok => {
        if (!ok) toast(`The overlay hotkey ${cfg.key} is taken by another app. Pick another one in the Overlay tab.`, "failure");
    }).catch(() => { });
}

// how long each part took the last time (shown in troubleshooting reports)
export const applyTimes: Record<string, number> = {};

export function applyAll() {
    const steps: [string, () => void][] = [
        ["attrs", applyAttrs], ["vars", applyVars], ["logo", applyLogo], ["chat", applyChat], ["header", applyHeader], ["font", applyFont],
        ["media", applyMedia], ["cardMedia", applyCardMedia], ["liquid", applyLiquid], ["loading", applyLoading], ["overlay", applyOverlay], ["dvd", applyDvd],
    ];
    for (const [name, fn] of steps) {
        const t = performance.now();
        fn();
        applyTimes[name] = Math.round((performance.now() - t) * 10) / 10;
    }
}

export function removeAll() {
    stopDvd();
    removeCardLayer();
    removeLiquid();
    removeTicker(driftTick);
    cardActive = false;
    if (cardUrl) URL.revokeObjectURL(cardUrl);
    cardUrl = null;
    videoEl?.remove();
    videoEl = null;
    bgObserver?.disconnect();
    bgObserver = null;
    document.removeEventListener("visibilitychange", onVisibility);
    fontLink?.remove();
    fontLink = null;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
    for (const k of Object.keys(sheets) as (keyof typeof sheets)[]) {
        sheets[k]?.remove();
        sheets[k] = null;
    }
    const d = document.documentElement.dataset;
    for (const k of ["dzPlugin", "dzBg", "dzCardFill", "dzGuilds", "dzChannels", "dzMembers", "dzGlass", "dzGlassBlur", "dzActivities", "dzLite", "dzUltra", "dzQuick", "dzDm", "dzCardMedia", "dzLiquid", "dzEmbed", "dzChat"]) delete d[k];
}
