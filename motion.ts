/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* ================= one slow clock for everything that drifts =================
   CSS animations run at the monitor's refresh rate (144 / 240 Hz), and a moving layer behind the whole window
   makes Chromium redraw the whole window that often, even for motion of a few pixels per second. The background
   drift and liquid glass move that slowly, so they're driven from here at 30 updates a second instead (the same
   look for ~5-8x less GPU work). Nothing ticks while Discord is hidden, minimized, or (by default) while another
   window, e.g. a game, has focus. */

// Moving things get a new position twice a second and the GPU glides to it (a CSS transition of the same length).
// Changing styles 30 times a second kept Discord's main thread busy 30-50% of the time while doing nothing, which
// made clicks and streams lag; this looks the same and costs almost nothing.
export const MOTION_STEP_MS = 500;

type Ticker = (seconds: number) => void;
const tickers = new Set<Ticker>();
let timer = 0;
let pauseWhenUnfocused = true;
const start = performance.now();

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function away() {
    return document.hidden || (pauseWhenUnfocused && !document.hasFocus());
}

function sync() {
    // CSS can pause its own small animations (badges) with this too
    document.documentElement.toggleAttribute("data-dz-away", away());
    const run = tickers.size > 0 && !away() && !reducedMotion.matches;
    if (run && !timer) timer = window.setInterval(tick, MOTION_STEP_MS);
    else if (!run && timer) {
        clearInterval(timer);
        timer = 0;
    }
}

function tick() {
    const t = (performance.now() - start) / 1000;
    for (const f of tickers) f(t);
}

export function addTicker(f: Ticker) {
    if (!tickers.has(f)) {
        tickers.add(f);
        f((performance.now() - start) / 1000);
        sync();
    }
}

export function removeTicker(f: Ticker) {
    if (tickers.delete(f)) sync();
}

export function setPauseWhenUnfocused(on: boolean) {
    pauseWhenUnfocused = on;
    sync();
}

// whether Discord is out of sight or out of focus right now (for other periodic work to skip)
export const isAway = away;

export function startMotion() {
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    sync();
}

export function stopMotion() {
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
    document.removeEventListener("visibilitychange", sync);
    reducedMotion.removeEventListener("change", sync);
    tickers.clear();
    clearInterval(timer);
    timer = 0;
    document.documentElement.removeAttribute("data-dz-away");
}
