/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

import { tc } from "./classes";

/* ================= streams first =================
   While a stream or a camera plays in Discord, or while you're streaming yourself, Terono steps aside: no blur,
   no liquid glass, no moving background, no bouncing logo, no animated rings, no fixed backgrounds. The look stays
   (colors, shapes, layout); only what keeps the graphics card redrawing is off, so the video gets the whole GPU,
   exactly as in plain Discord. Marked with data-dz-video on <html>; the CSS is STREAM_CSS. */

const StreamingStore = findStoreLazy("ApplicationStreamingStore");
const VIDEO = () => tc("[data-selenium-video-tile] video, .pictureInPictureWindow__6341f video");

let timer = 0;
const listeners = new Set<(on: boolean) => void>();
export const onStreamMode = (f: (on: boolean) => void) => { listeners.add(f); return () => void listeners.delete(f); };
export const inStreamMode = () => document.documentElement.hasAttribute("data-dz-video");

export function streaming() {
    try { return !!StreamingStore.getCurrentUserActiveStream?.(); } catch { return false; }
}

function check() {
    const on = streaming() || !!document.querySelector(VIDEO());
    if (on === inStreamMode()) return;
    document.documentElement.toggleAttribute("data-dz-video", on);
    listeners.forEach(f => { try { f(on); } catch { } });
}

const EVENTS = ["STREAM_START", "STREAM_STOP", "STREAM_CREATE", "STREAM_DELETE", "STREAM_WATCH", "STREAM_CLOSE", "VIDEO_SAVE_LAST_USED_BACKGROUND_OPTION", "RTC_CONNECTION_VIDEO", "VOICE_CHANNEL_SELECT"];
const soon = () => setTimeout(check, 300);

export function startStreamMode() {
    check();
    timer = window.setInterval(check, 1000);
    for (const e of EVENTS) FluxDispatcher.subscribe(e, soon);
}

export function stopStreamMode() {
    clearInterval(timer);
    for (const e of EVENTS) FluxDispatcher.unsubscribe(e, soon);
    document.documentElement.removeAttribute("data-dz-video");
}

export const STREAM_CSS = `
html[data-dz-video] *, html[data-dz-video] *::before, html[data-dz-video] *::after {
    backdrop-filter: none !important;
    background-attachment: scroll !important;
}
html[data-dz-video] :is(.dz-liquid, .dz-dvd, .dz-bg-video) { display: none !important; }
html[data-dz-video] #app-mount .bg__960e4::before { animation: none !important; transition: none !important; }
html[data-dz-video] .listItem__650eb::after, html[data-dz-video] .numberBadge__463b7 { animation: none !important; }
`;
