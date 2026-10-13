/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { refreshSettingsUi, settings } from "./settings";

// Theme presets: complete looks (the ones in the README gallery, whose screenshots are taken from these exact
// values). A preset sets every look option, so the result is the same whatever was set before; logo, menus, chat
// bar buttons, translate and performance stay as the user has them. Everything can be changed afterwards.

export interface Preset {
    id: string;
    name: string;
    description: string;
    values: Record<string, string | number | boolean>;
}

// the look options a preset controls, with the values every preset starts from
const BASE: Record<string, string | number | boolean> = {
    accentPreset: "blue", accent: "#429cff", voice: "#35b889", close: "#d94a5d", minimize: "#d29b2e", maximize: "#35b889",
    cardPreset: "dark", cardFill: "solid", cardColor: "#070708", cardColor2: "#0b1a33", cardAngle: 135, textColor: "#f1f2f4",
    customText: false, customIcons: false,
    embedStyle: "cards",
    panels: "cards", cardShape: "curved", cardStyle: "solid", glassOpacity: 60, glassBlur: true, cardMedia: "none", cardMediaDim: 60,
    background: "animated", bgBase: "#000000", bgColor1: "#429cff", bgColor2: "#0b2a55",
    serverList: "top", serverListDirection: "ltr", channelsSide: "left", membersSide: "right",
    headerName: "left", headerHash: true, headerFollow: false, headerButtons: "left", headerSearch: "right",
    dmHeaderName: "hidden", dmHeaderButtons: "left", dmHeaderSearch: "right",
    font: "terono", roleCount: "paren", roleCountCustom: "(%users%)",
};

const CLASSIC = { headerName: "middle", headerHash: false, roleCount: "custom", roleCountCustom: "「%users%」" };

export const PRESETS: Preset[] = [
    {
        id: "default", name: "Default",
        description: "Normal Discord: joined panels, Discord's colors, font and layout. Change any color or layout you like.",
        values: {
            panels: "discord", accentPreset: "custom", accent: "#5865f2", cardPreset: "gray", cardShape: "soft", background: "solid", bgBase: "#121214",
            serverList: "left", headerName: "left", headerButtons: "right", headerSearch: "right", dmHeaderName: "left", dmHeaderButtons: "right",
            font: "discord", roleCount: "dash",
        },
    },
    {
        id: "classic", name: "Terono Classic",
        description: "Blue on black, dark cards, server list on top, channel name centered.",
        values: { ...CLASSIC },
    },
    {
        id: "frosted", name: "Frosted Glass",
        description: "See-through blurred cards over a blue-violet glow.",
        values: { ...CLASSIC, cardStyle: "glass", glassOpacity: 55, bgColor1: "#6d5dfc", bgColor2: "#1a0b3d" },
    },
    {
        id: "paper", name: "Paper White",
        description: "Light cards on a soft blue-gray background.",
        values: { ...CLASSIC, cardPreset: "white", background: "static", bgBase: "#dfe6f2", bgColor1: "#429cff", bgColor2: "#9ec5ff" },
    },
    {
        id: "crimson", name: "Crimson Edge",
        description: "Red, gray cards with sharp corners, server list on the left, Inter.",
        values: { accentPreset: "red", accent: "#ff4d5e", cardPreset: "gray", cardShape: "sharp", serverList: "left", bgColor1: "#ff4d5e", bgColor2: "#3a0a12", font: "inter", roleCount: "dot" },
    },
    {
        id: "emerald", name: "Emerald",
        description: "Green, round cards, server list on the right, centered title, Outfit.",
        values: { accentPreset: "green", accent: "#3ecf8e", cardShape: "round", serverList: "right", bgColor1: "#3ecf8e", bgColor2: "#07301f", font: "outfit", roleCount: "bracket", headerName: "middle" },
    },
    {
        id: "sakura", name: "Sakura Glass",
        description: "Pink glass cards with round corners over a pink-purple glow, Poppins.",
        values: { accentPreset: "pink", accent: "#ff5fa8", cardStyle: "glass", glassOpacity: 50, cardShape: "round", bgBase: "#12030b", bgColor1: "#ff5fa8", bgColor2: "#5a1d8a", font: "poppins" },
    },
    {
        id: "amber", name: "Amber Dock",
        description: "Orange, gray cards, server list at the bottom, members next to the channels.",
        values: { accentPreset: "orange", accent: "#ff8a3d", cardPreset: "gray", serverList: "bottom", membersSide: "left", bgColor1: "#ff8a3d", bgColor2: "#3a1a05", font: "manrope", roleCount: "space" },
    },
    {
        id: "lagoon", name: "Deep Lagoon",
        description: "Teal to indigo gradient cards with a teal accent, Plus Jakarta Sans.",
        values: {
            accentPreset: "custom", accent: "#2de2c8", cardPreset: "custom", cardFill: "gradient", cardColor: "#062a33", cardColor2: "#1b1145",
            cardAngle: 135, customText: true, textColor: "#e8fbf8", cardShape: "soft", bgBase: "#02070a", bgColor1: "#1fb8a8", bgColor2: "#3a1d8a", font: "jakarta", roleCount: "bracket",
        },
    },
    {
        id: "mirror", name: "Mirror White",
        description: "White cards and a fully mirrored layout: servers and channels right, members left.",
        values: {
            cardPreset: "white", cardShape: "soft", background: "static", channelsSide: "right", membersSide: "left", serverList: "right",
            bgBase: "#dfe6f2", bgColor1: "#429cff", bgColor2: "#9ec5ff", font: "dmsans", headerName: "right", headerButtons: "right", headerSearch: "left",
        },
    },
    {
        id: "violet", name: "Violet Focus",
        description: "Purple glass without blur, centered channel name, no role counts, Sora.",
        values: { accentPreset: "purple", accent: "#9b6dff", cardStyle: "glass", glassOpacity: 70, glassBlur: false, bgColor1: "#9b6dff", bgColor2: "#1d0b3a", headerName: "middle", font: "sora", roleCount: "hidden" },
    },
    {
        id: "minimal", name: "Minimal",
        description: "Solid black, soft corners, server list on the left, Discord's own font.",
        values: { cardShape: "soft", background: "solid", bgBase: "#050506", serverList: "left", font: "discord", roleCount: "dash" },
    },
];

// "layout": where things sit. A preset can be applied with or without it; everything else is "theme".
export const LAYOUT_KEYS = new Set([
    "serverList", "serverListDirection", "channelsSide", "membersSide",
    "headerName", "headerHash", "headerFollow", "headerButtons", "headerSearch", "dmHeaderName", "dmHeaderButtons", "dmHeaderSearch",
]);

export const presetValues = (p: Preset) => ({ ...BASE, ...p.values });

// every option a preset can change
export const PRESET_KEYS = Object.keys(BASE);

export function writePresetValues(p: Preset, withLayout: boolean) {
    const store = settings.store as Record<string, unknown>;
    for (const [k, v] of Object.entries(presetValues(p))) if (withLayout || !LAYOUT_KEYS.has(k)) store[k] = v;
}

export function applyPreset(p: Preset, withLayout = true) {
    writePresetValues(p, withLayout);
    (settings.store as Record<string, unknown>).presetId = p.id;
    refreshSettingsUi();
}

// "In use" = the preset's theme is on (with its layout or the user's own)
export function presetMatches(p: Preset) {
    const store = settings.store as Record<string, unknown>;
    return Object.entries(presetValues(p)).every(([k, v]) => LAYOUT_KEYS.has(k) || (typeof v === "string" && typeof store[k] === "string"
        ? (store[k] as string).toLowerCase() === v.toLowerCase()
        : store[k] === v));
}
