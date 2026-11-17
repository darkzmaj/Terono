/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";
import { streaming } from "./streammode";

/* ================= ambient mode =================
   The colors of the stream you're watching glow softly around it, like YouTube's ambient mode. Discord's call view
   itself is left exactly as it is. The glow is a second, tiny video element playing the same stream (Discord gives
   its video a live MediaStream), blurred and stretched by the GPU. Nothing is copied off the GPU, so it follows the
   stream frame for frame and costs the stream nothing. (Copying frames into a canvas, as before, pulled every
   1440p frame back to the CPU and made streams stutter.) Only the big stream in the focused view gets one. */

interface Glow { glow: HTMLVideoElement; video: HTMLVideoElement; host: HTMLElement; ro: ResizeObserver; sync(): void; }
const glows = new Map<HTMLVideoElement, Glow>();
// the glow is decoded tiny and scaled up: its own size barely matters, so keep it cheap
const GW = 64, GH = 36;

function sizeGlow(g: Glow) {
    const w = g.host.clientWidth, h = g.host.clientHeight;
    g.glow.style.setProperty("--dz-sx", String(w * 1.14 / GW));
    g.glow.style.setProperty("--dz-sy", String(h * 1.24 / GH));
    g.glow.style.left = `${-w * .07}px`;
    g.glow.style.top = `${-h * .12}px`;
}

function stopGlow(g: Glow) {
    for (const e of ["loadstart", "emptied", "play"]) g.video.removeEventListener(e, g.sync);
    g.ro.disconnect();
    g.glow.srcObject = null;
    g.glow.remove();
    g.host.classList.remove("dz-amb-host");
}

function syncGlows() {
    const want = new Set<HTMLVideoElement>();
    // not while you're streaming yourself: your PC is encoding then, and the glow would be a second copy to draw
    if (settings.store.callAmbient && !streaming()) {
        // the big streams in the call view (focused or in the grid), not the small tiles: Discord's current build
        // dropped the old focused-view wrapper, so pick by size instead of by class
        for (const v of document.querySelectorAll<HTMLVideoElement>("[class*=callContainer_] [data-selenium-video-tile] video:not(.dz-ambient)")) {
            // streams glow in the grid too (a stream tile there is ~300px wide); cameras only when they're big
            const tile = v.closest("[data-selenium-video-tile]");
            const stream = !!tile?.querySelector('[class*="liveIndicator"], [class*="streamPreview"]') || /\bLIVE\b/.test(tile?.textContent ?? "");
            if (v.clientWidth >= (stream ? 240 : 420)) want.add(v);
        }
    }
    for (const [v, g] of glows) if (!want.has(v) || !g.host.isConnected) { stopGlow(g); glows.delete(v); }
    for (const v of want) {
        if (glows.has(v)) continue;
        // the tile clips its corners, so the glow goes on the box around it
        const host = v.closest<HTMLElement>("[data-selenium-video-tile]")?.parentElement;
        if (!host) continue;
        host.classList.add("dz-amb-host");
        // the glow is placed relative to the box: give it a position only if Discord didn't
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        const glow = Object.assign(document.createElement("video"), { className: "dz-ambient", muted: true, autoplay: true, playsInline: true, disablePictureInPicture: true, width: GW, height: GH });
        glow.setAttribute("aria-hidden", "true");
        host.prepend(glow);
        const g: Glow = {
            glow, video: v, host, ro: new ResizeObserver(() => sizeGlow(g)),
            // Discord swaps the stream object when a stream pauses or restarts: follow it
            sync: () => {
                if (glow.srcObject !== v.srcObject) glow.srcObject = v.srcObject;
                if (glow.srcObject && glow.paused) glow.play().catch(() => { });
            },
        };
        for (const e of ["loadstart", "emptied", "play"]) v.addEventListener(e, g.sync);
        g.ro.observe(host);
        sizeGlow(g);
        glows.set(v, g);
        g.sync();
    }
}

/* ---------- start / stop ---------- */

let frame = 0;
let observer: MutationObserver | null = null;
let watchTimer = 0;
let watched: Element | null = null;

const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; syncGlows(); }); };

export const applyAmbient = schedule;

// the observer only runs while a call view is on screen
function watchCall() {
    const view = document.querySelector("[class*=callContainer_]");
    if (view === watched) return;
    observer?.disconnect();
    watched = view;
    if (view) {
        observer ??= new MutationObserver(schedule);
        observer.observe(view, { childList: true, subtree: true });
    }
    schedule();
}

export function startCall() {
    watchTimer = window.setInterval(watchCall, 1000);
    watchCall();
}

export function stopCall() {
    clearInterval(watchTimer);
    observer?.disconnect();
    observer = null;
    watched = null;
    cancelAnimationFrame(frame);
    frame = 0;
    for (const g of glows.values()) stopGlow(g);
    glows.clear();
}

export const CALL_CSS = `
.dz-ambient { position: absolute; width: 64px !important; height: 36px !important; object-fit: fill; z-index: -1; pointer-events: none; transform-origin: 0 0;
    transform: scale(var(--dz-sx, 20), var(--dz-sy, 20)); filter: blur(3px) saturate(1.5); opacity: .6; will-change: transform; animation: dz-amb-in .5s ease both; }
.dz-amb-host { overflow: visible !important; isolation: isolate; }
@keyframes dz-amb-in { from { opacity: 0; } }
`;
