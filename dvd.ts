/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* ================= the bouncing logo =================
   A logo (or your own picture) drifting behind the panels like an old DVD player's screensaver. It only moves with
   transform on its own layer (no layout, no repaint), at most 60 times a second whatever the monitor's refresh rate.
   About half of the bounces are aimed at the corner ahead, so it does hit corners, just not every time. It stops
   while Discord is hidden, and in Performance / Ultimate performance mode also while Discord isn't the active
   window. */

const FPS_STEP = 1000 / 60;
const CORNER_CHANCE = 0.5;
// legs aimed at a corner keep a DVD-like angle: never flatter or steeper than this (degrees from the horizontal)
const MIN_ANGLE = 22;
const MAX_ANGLE = 68;
const COLORS = ["#429cff", "#ff4f7b", "#ffd23f", "#3ddc97", "#b388ff", "#ff9a3c", "#4ff0ff"];

const LOGO = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 110\" fill=\"currentColor\"><text x=\"100\" y=\"60\" text-anchor=\"middle\" font-family=\"Arial Black, Arial, sans-serif\" font-size=\"62\" font-weight=\"900\" font-style=\"italic\" letter-spacing=\"-3\">DVD</text><ellipse cx=\"100\" cy=\"88\" rx=\"78\" ry=\"14\"/><text x=\"100\" y=\"93\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\" font-size=\"13\" font-weight=\"700\" fill=\"#000\" fill-opacity=\".85\" letter-spacing=\"5\">TERONO</text></svg>";

export interface DvdOptions { size: number; speed: number; image: string | null; strictPause: boolean; }

let el: HTMLDivElement | null = null;
let opts: DvdOptions | null = null;
let raf = 0;
let last = 0;
let lastFrame = 0;
let x = 40, y = 40, vx = 1, vy = 1;
let color = 0;
let videoCheck = 0;
let covered = false;

function bounds() {
    const w = el!.offsetWidth || 1, h = el!.offsetHeight || 1;
    return { mx: Math.max(0, innerWidth - w), my: Math.max(0, innerHeight - h) };
}

function setDirection(dx: number, dy: number) {
    const len = Math.hypot(dx, dy) || 1;
    vx = dx / len;
    vy = dy / len;
}

// after a bounce: half of the time, head straight for the corner ahead if that keeps a sensible angle
function maybeAimAtCorner() {
    if (Math.random() >= CORNER_CHANCE) return;
    const { mx, my } = bounds();
    const tx = vx > 0 ? mx : 0, ty = vy > 0 ? my : 0;
    const dx = tx - x, dy = ty - y;
    if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return;
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
    if (angle >= MIN_ANGLE && angle <= MAX_ANGLE) setDirection(dx, dy);
}

function bounce() {
    color = (color + 1) % COLORS.length;
    if (!opts?.image) el!.style.color = COLORS[color];
    maybeAimAtCorner();
}

function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (now - lastFrame < FPS_STEP - 1) return;
    lastFrame = now;
    // a long gap (paused, a hiccup) continues from where it was instead of jumping
    const dt = Math.min(now - last, 50) / 1000;
    last = now;
    if (covered) return;
    const { mx, my } = bounds();
    const step = opts!.speed * dt;
    x += vx * step;
    y += vy * step;
    let hit = false;
    if (x <= 0) { x = 0; vx = Math.abs(vx); hit = true; } else if (x >= mx) { x = mx; vx = -Math.abs(vx); hit = true; }
    if (y <= 0) { y = 0; vy = Math.abs(vy); hit = true; } else if (y >= my) { y = my; vy = -Math.abs(vy); hit = true; }
    if (hit) bounce();
    el!.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
}

function shouldRun() {
    if (!el || document.hidden) return false;
    return !opts!.strictPause || document.hasFocus();
}

function sync() {
    const run = shouldRun();
    if (run && !raf) {
        last = lastFrame = performance.now();
        raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
    }
}

function place() {
    if (!el) return;
    const bg = document.querySelector("#app-mount .bg__960e4");
    if (bg && el.previousElementSibling !== bg) bg.after(el);
    else if (!bg && !el.isConnected) document.getElementById("app-mount")?.prepend(el);
}

export function startDvd(o: DvdOptions) {
    opts = o;
    if (!el) {
        el = document.createElement("div");
        el.className = "dz-dvd";
        el.setAttribute("aria-hidden", "true");
        setDirection(Math.random() < 0.5 ? -1 : 1, Math.random() < 0.5 ? -0.8 : 0.8);
        window.addEventListener("focus", sync);
        window.addEventListener("blur", sync);
        document.addEventListener("visibilitychange", sync);
        // a fullscreen stream covers it anyway (checked now and then, not every frame); in calls it keeps moving:
        // moving one small layer costs a stream nothing
        videoCheck = window.setInterval(() => {
            covered = !!document.fullscreenElement;
            place();
        }, 1000);
    }
    el.style.width = `${o.size}px`;
    el.style.color = COLORS[color];
    el.innerHTML = o.image ? "" : LOGO;
    if (o.image) {
        const img = document.createElement("img");
        img.src = o.image;
        img.alt = "";
        el.append(img);
    }
    place();
    sync();
}

export function stopDvd() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(videoCheck);
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
    document.removeEventListener("visibilitychange", sync);
    el?.remove();
    el = null;
    opts = null;
}

export const DVD_CSS = `
.dz-dvd { position: fixed; left: 0; top: 0; z-index: 0; pointer-events: none; will-change: transform; contain: layout paint; opacity: .9; }
.dz-dvd svg, .dz-dvd img { display: block; width: 100%; height: auto; }
.dz-dvd img { border-radius: 6px; }
`;
