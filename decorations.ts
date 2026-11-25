/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useRef, useState } from "@webpack/common";

import { tc } from "./classes";
import { inStreamMode, onStreamMode } from "./streammode";

/* ================= decorations =================
   Seasonal things (snow, lights, cobwebs, bats, leaves, bunting…) on one see-through canvas in front of the
   panels; it ignores the mouse, so it never blocks a click. Any animation loop on Discord's own thread made it
   render whole frames 60 times a second (11-15% busier even with nothing drawn), so the canvas is handed to a
   Web Worker (transferControlToOffscreen): the worker simulates and draws, and its frames go straight to the
   compositor. Discord's thread only measures the panels once a second, forwards the mouse ~30 times a second and
   says when to pause (Discord hidden, a stream or camera playing, Performance mode and Discord not in front).
   Where a worker can't be made, the same engine runs here at half resolution.

   The engine (decoEngine) is turned into the worker's source with toString(), so it must not use anything from
   outside its own body: no imports, no module constants. Set pieces (webs, trees, garland…) are drawn into a
   cached layer when the panels move; each frame is then that layer, a few sprites and the particles, with no new
   objects. Nothing that stays put is drawn over the window buttons or the back / forward arrows. */

export interface DecorationOptions {
    theme: string;
    density: number;
    speed: number;
    size: number;
    colors: string[] | null;
    mouse: boolean;
    lights: boolean;
    piles: boolean;
    custom: {
        shape: "circle" | "star" | "heart" | "snowflake" | "leaf" | "drawn" | "image";
        image: string | null;
        direction: "down" | "up" | "drift";
        rotate: boolean;
        color: string;
    };
    strictPause: boolean;
    /** set pieces: webs, trees, pumpkins, garland, snowman, bunting… (default on) */
    props?: boolean;
}

export const DECORATION_THEMES: [id: string, label: string][] = [
    ["none", "None"],
    ["christmas", "Christmas"],
    ["winter", "Winter"],
    ["halloween", "Halloween"],
    ["autumn", "Autumn"],
    ["summer", "Summer"],
    ["easter", "Easter"],
    ["aprilfools", "April Fools"],
    ["birthday", "Birthday"],
    ["custom", "Custom"],
];

type Shape = "circle" | "glow" | "star" | "heart" | "snowflake" | "leaf" | "confetti" | "egg" | "petal" | "bat" | "balloon" | "flip" | "drawn" | "image";
type Motion = "fall" | "rise" | "drift" | "bat";
interface Kind {
    shape: Shape; weight: number; min: number; max: number; motion: Motion;
    v?: number; sway?: number; spin?: boolean; twinkle?: boolean; lands?: boolean; pops?: boolean; alpha?: number; colors?: string[];
}
interface Theme { colors: string[]; kinds: Kind[]; pile?: "snow" | "leaves"; gusts?: boolean; }
interface Port { onmessage: ((e: { data: any; }) => void) | null; postMessage(m: unknown): void; }
type Ctx = OffscreenCanvasRenderingContext2D;

/* ================= the engine (worker or fallback) ================= */

function decoEngine(port: Port) {
    const MAX = 400;
    const FPS_STEP = 1000 / 60;
    const TAU = Math.PI * 2;
    const ALPHA = 0.8; // particles stay a little see-through over text
    const MOUSE_R = 90;
    const MAX_MAIN = 12, MAX_SURF = 64, COL = 4, COLS = 1024, PILE_MAX = 18, MELT = 0.05;
    // kept clear of anything that stays put: the window buttons (right) and back / forward arrows (left)
    const LEFT_CLEAR = 90, RIGHT_CLEAR = 150, TOP_CLEAR = 40;
    const SWAG = 110;

    const SNOW = ["#ffffff", "#e8f4ff", "#d6ecff"];
    const CONFETTI = ["#ff4f7b", "#ffd23f", "#3ddc97", "#429cff", "#b388ff", "#ff9a3c"];
    const LIGHTS = ["#ff3b3b", "#ffd23f", "#3ddc97", "#429cff", "#ff7ad9"];
    const ORNAMENTS = ["#d62d2d", "#e3b23c", "#2d6fd6", "#c0c8d0", "#7a3fd1", "#2a9d5b"];
    const THEMES: Record<string, Theme> = {
        christmas: {
            colors: SNOW, pile: "snow", kinds: [
                { shape: "snowflake", weight: 0.55, min: 7, max: 15, motion: "fall", sway: 14, spin: true, lands: true },
                { shape: "circle", weight: 0.45, min: 2, max: 5, motion: "fall", sway: 10, lands: true, alpha: 0.85 },
            ],
        },
        winter: {
            colors: SNOW, pile: "snow", kinds: [
                { shape: "snowflake", weight: 0.4, min: 6, max: 13, motion: "fall", v: 0.6, sway: 12, spin: true, lands: true },
                { shape: "circle", weight: 0.6, min: 2, max: 4, motion: "fall", v: 0.6, sway: 8, alpha: 0.8, lands: true },
            ],
        },
        halloween: {
            colors: ["#ff8a1f", "#b14dff", "#ffb347"], kinds: [
                { shape: "bat", weight: 0.14, min: 18, max: 30, motion: "bat", colors: ["#241530"] },
                { shape: "glow", weight: 0.56, min: 4, max: 10, motion: "rise", v: 0.7, sway: 16, twinkle: true },
                { shape: "leaf", weight: 0.3, min: 10, max: 18, motion: "fall", v: 0.7, sway: 34, spin: true, colors: ["#4a2c17", "#3a2412", "#5c1f0b", "#6b4a1a"] },
            ],
        },
        aprilfools: {
            colors: CONFETTI, kinds: [
                { shape: "confetti", weight: 0.98, min: 6, max: 11, motion: "fall", sway: 20, spin: true },
                { shape: "flip", weight: 0.02, min: 20, max: 28, motion: "fall", v: 0.5 },
            ],
        },
        summer: {
            colors: ["#fff3b0", "#ffd166", "#ffb347", "#ffffff"], kinds: [
                { shape: "glow", weight: 0.7, min: 14, max: 42, motion: "drift", v: 0.5, alpha: 0.35, twinkle: true },
                { shape: "star", weight: 0.3, min: 4, max: 9, motion: "drift", v: 0.4, twinkle: true, spin: true },
            ],
        },
        autumn: {
            colors: ["#e8711a", "#c0392b", "#8b4513", "#f4a300"], pile: "leaves", gusts: true, kinds: [
                { shape: "leaf", weight: 1, min: 12, max: 22, motion: "fall", v: 0.8, sway: 40, spin: true, lands: true },
            ],
        },
        easter: {
            colors: ["#ffd1dc", "#c5f0d4", "#fff4b8", "#d7c8ff", "#bfe6ff"], kinds: [
                { shape: "egg", weight: 0.15, min: 12, max: 18, motion: "fall", v: 0.6, sway: 10, spin: true },
                { shape: "petal", weight: 0.85, min: 6, max: 11, motion: "fall", v: 0.7, sway: 30, spin: true },
            ],
        },
        birthday: {
            colors: CONFETTI, kinds: [
                { shape: "confetti", weight: 0.8, min: 6, max: 11, motion: "fall", sway: 20, spin: true },
                { shape: "balloon", weight: 0.2, min: 30, max: 44, motion: "rise", v: 0.8, sway: 12, pops: true },
            ],
        },
    };

    let cv: OffscreenCanvas | HTMLCanvasElement | null = null;
    let g: Ctx | null = null;
    let W = 0, H = 0, dpr = 1;
    let o: DecorationOptions | null = null;
    let image: ImageBitmap | null = null;
    let theme: Theme | null = null;
    let kinds: Kind[] = [];
    let props = true;
    let cumWeight = new Float32Array(0), kindSprite = new Int16Array(0), kindSprites = new Int16Array(0);
    let sprites: OffscreenCanvas[] = [];
    let spriteKey = "", particleKey = "";
    let burstPop = -1, burstPile = -1, piling = false;
    let running = false, timer = 0, raf = 0, last = 0, lastFrame = 0, t = 0;
    let mx = -9999, my = -9999, pmx = -9999, pmy = -9999, mouseIn = false;
    let wind = 0, gustT = 6, gustAge = 99, gustA = 0;
    let seed = 1;

    // particles: 0..count-1 live forever, count..live-1 are short bursts (swept snow, popped balloons)
    let count = 0, live = 0;
    const px = new Float32Array(MAX), py = new Float32Array(MAX), vx = new Float32Array(MAX), vy = new Float32Array(MAX);
    const pushX = new Float32Array(MAX), pushY = new Float32Array(MAX), rot = new Float32Array(MAX), vr = new Float32Array(MAX);
    const sz = new Float32Array(MAX), ph = new Float32Array(MAX), phs = new Float32Array(MAX), life = new Float32Array(MAX);
    const kd = new Uint8Array(MAX), spr = new Int16Array(MAX);

    // the big panels (set pieces sit on them), the chat (particles fade over it) and every surface snow settles on
    let floors = 0; // surfaces from here on are panel floors: everything that reaches one settles there
    let mN = 0, cX = 0, cY = 0, cW = 0, cH = 0;
    const mX = new Float32Array(MAX_MAIN), mY = new Float32Array(MAX_MAIN), mW = new Float32Array(MAX_MAIN), mH = new Float32Array(MAX_MAIN);
    // the panels set pieces belong to: [x, y, w, h, radius] each, w = 0 when not on screen
    // 0 your DM / friends list, 1 your profile panel, 2 the chat (or friends page), 3 the message box
    const Z = new Float32Array(20);
    const zx = (k: number) => Z[k * 5], zy = (k: number) => Z[k * 5 + 1], zw = (k: number) => Z[k * 5 + 2], zh = (k: number) => Z[k * 5 + 3], zr = (k: number) => Z[k * 5 + 4];
    const zon = (k: number) => Z[k * 5 + 2] > 0;
    // pieces that stand in a corner (snowman, tree): drawn every frame so they can fade while the mouse is near
    let cornerPiece: OffscreenCanvas | null = null, cpX = 0, cpY = 0, cpW = 0, cpH = 0, cpA = 1;
    let sN = 0;
    const sL = new Float32Array(MAX_SURF), sT = new Float32Array(MAX_SURF), sW = new Float32Array(MAX_SURF);
    const heights = new Float32Array(MAX_SURF * COLS);

    // set pieces: a cached layer for what stays still, small arrays for what moves
    let layer: OffscreenCanvas | null = null, layerEmpty = true;
    let bulbs = 0;
    const bulbX = new Float32Array(512), bulbY = new Float32Array(512), bulbS = new Float32Array(512);
    let glowSprites: OffscreenCanvas[] = [], bulbSprites: OffscreenCanvas[] = [];
    let pumpkins = 0;
    const pkX = new Float32Array(12), pkY = new Float32Array(12);
    let pkBody: OffscreenCanvas | null = null, pkFace: OffscreenCanvas | null = null, warm: OffscreenCanvas | null = null;
    let ornaments = 0;
    const orX = new Float32Array(8), orY = new Float32Array(8), orH = new Float32Array(8);
    const orSprites: OffscreenCanvas[] = [];
    let spOn = false, spX = 0, spTop = 0, spLen = 0, spTarget = 0, spState = 0, spTimer = 4, spFlee = false;
    let spider: OffscreenCanvas | null = null;
    let sun: OffscreenCanvas | null = null;
    let bunny: OffscreenCanvas | null = null, bunnyOn = false, bunnyShow = 0;
    let balloons = 0;
    const bbX = new Float32Array(8), bbY = new Float32Array(8), bbAX = new Float32Array(8), bbAY = new Float32Array(8), bbPop = new Float32Array(8);
    let bbSprites: OffscreenCanvas[] = [];
    let eyes = 0, eyeKick = 3;
    const eyX = new Float32Array(8), eyY = new Float32Array(8), eyOX = new Float32Array(8), eyOY = new Float32Array(8), eyVX = new Float32Array(8), eyVY = new Float32Array(8);
    let eyeWhite: OffscreenCanvas | null = null, pupil: OffscreenCanvas | null = null;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    // repeatable randomness for set pieces, so they don't jump around when the panels are measured again
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const free = (x: number, y: number, r: number) => !(y - r < TOP_CLEAR && (x + r > W - RIGHT_CLEAR || x - r < LEFT_CLEAR));

    /* ---------- sprites ---------- */

    // a sprite canvas w x h CSS px at the canvas resolution, drawn in CSS px
    function sp(w: number, h: number) {
        const c = new OffscreenCanvas(Math.ceil(w * dpr) + 1, Math.ceil(h * dpr) + 1).getContext("2d")!;
        c.scale(dpr, dpr);
        return c;
    }

    function glow(c: Ctx, x: number, y: number, r: number, color: string, a: number) {
        const gr = c.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, color);
        gr.addColorStop(0.3, color + (a > 0.5 ? "99" : "55"));
        gr.addColorStop(1, color + "00");
        c.fillStyle = gr;
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.fill();
    }

    function balloonShape(c: Ctx, r: number) {
        c.beginPath();
        c.ellipse(0, -r * 0.2, r * 0.55, r * 0.68, 0, 0, TAU);
        c.fill();
        c.beginPath();
        c.moveTo(-r * 0.08, r * 0.54); c.lineTo(r * 0.08, r * 0.54); c.lineTo(0, r * 0.46);
        c.fill();
        c.beginPath();
        c.fillStyle = "rgba(255,255,255,.35)";
        c.ellipse(-r * 0.2, -r * 0.45, r * 0.11, r * 0.2, -0.4, 0, TAU);
        c.fill();
    }

    function paint(shape: Shape, color: string, res: number) {
        const cnv = new OffscreenCanvas(res, res);
        const c = cnv.getContext("2d")!;
        const r = res / 2;
        c.translate(r, r);
        c.fillStyle = c.strokeStyle = color;
        c.beginPath();
        switch (shape) {
            case "circle":
                c.arc(0, 0, r * 0.9, 0, TAU);
                c.fill();
                break;
            case "glow":
                glow(c, 0, 0, r, color, 1);
                break;
            case "star":
                for (let i = 0; i < 10; i++) {
                    const a = i * Math.PI / 5 - Math.PI / 2, d = i % 2 ? r * 0.42 : r * 0.95;
                    c.lineTo(Math.cos(a) * d, Math.sin(a) * d);
                }
                c.fill();
                break;
            case "heart":
                c.moveTo(0, r * 0.85);
                c.bezierCurveTo(-r * 1.2, -r * 0.1, -r * 0.55, -r * 0.95, 0, -r * 0.35);
                c.bezierCurveTo(r * 0.55, -r * 0.95, r * 1.2, -r * 0.1, 0, r * 0.85);
                c.fill();
                break;
            case "snowflake":
                c.lineWidth = Math.max(1, r * 0.13);
                c.lineCap = "round";
                for (let i = 0; i < 6; i++) {
                    c.rotate(Math.PI / 3);
                    c.moveTo(0, 0); c.lineTo(0, -r * 0.88);
                    c.moveTo(0, -r * 0.5); c.lineTo(r * 0.25, -r * 0.72);
                    c.moveTo(0, -r * 0.5); c.lineTo(-r * 0.25, -r * 0.72);
                }
                c.stroke();
                break;
            case "leaf":
                c.moveTo(0, -r * 0.9);
                c.quadraticCurveTo(r * 0.8, -r * 0.1, 0, r * 0.7);
                c.quadraticCurveTo(-r * 0.8, -r * 0.1, 0, -r * 0.9);
                c.fill();
                c.beginPath();
                c.strokeStyle = "rgba(0,0,0,.3)";
                c.lineWidth = Math.max(1, r * 0.07);
                c.moveTo(0, -r * 0.75); c.lineTo(0, r * 0.95);
                c.stroke();
                break;
            case "confetti":
                c.fillRect(-r * 0.7, -r * 0.32, r * 1.4, r * 0.64);
                break;
            case "egg":
                c.ellipse(0, r * 0.05, r * 0.62, r * 0.85, 0, 0, TAU);
                c.fill();
                c.clip();
                c.fillStyle = "rgba(255,255,255,.75)";
                c.fillRect(-r, -r * 0.1, res, r * 0.22);
                c.fillStyle = "rgba(0,0,0,.12)";
                c.fillRect(-r, r * 0.35, res, r * 0.12);
                break;
            case "petal":
                c.ellipse(0, 0, r * 0.42, r * 0.88, 0, 0, TAU);
                c.fill();
                break;
            case "bat": {
                // an orange rim so a dark bat still shows on a dark background
                c.shadowColor = "#ff7a00";
                c.shadowBlur = r * 0.25;
                // right wing as quadratic curves (control x, y, end x, y), mirrored for the left one
                const B = [0.4, -0.6, 0.95, -0.35, 0.7, -0.05, 0.6, 0.2, 0.4, 0, 0.25, 0.25, 0.12, 0.1, 0, 0.3];
                c.moveTo(0, -r * 0.15);
                for (let i = 0; i < 16; i += 4) c.quadraticCurveTo(B[i] * r, B[i + 1] * r, B[i + 2] * r, B[i + 3] * r);
                for (let i = 12; i >= 0; i -= 4) c.quadraticCurveTo(-B[i] * r, B[i + 1] * r, i ? -B[i - 2] * r : 0, i ? B[i - 1] * r : -r * 0.15);
                c.fill();
                c.beginPath();
                c.arc(0, -r * 0.08, r * 0.15, 0, TAU);
                c.fill();
                break;
            }
            case "balloon":
                balloonShape(c, r);
                c.beginPath();
                c.strokeStyle = "rgba(255,255,255,.6)";
                c.lineWidth = 1;
                c.moveTo(0, r * 0.54);
                c.quadraticCurveTo(r * 0.15, r * 0.77, 0, r);
                c.stroke();
                break;
            case "flip":
                c.font = `${Math.round(res * 0.8)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
                c.textAlign = "center";
                c.textBaseline = "middle";
                c.rotate(Math.PI);
                c.fillText("\u{1F602}", 0, r * 0.06);
                break;
            case "drawn":
            case "image": {
                if (!image) break;
                const k = res / Math.max(image.width, image.height);
                const w = image.width * k, h = image.height * k;
                c.drawImage(image, -w / 2, -h / 2, w, h);
                // a drawing is a stencil in the chosen color; an uploaded picture keeps its own colors
                if (shape === "drawn") {
                    c.globalCompositeOperation = "source-in";
                    c.fillRect(-r, -r, res, res);
                }
                break;
            }
        }
        return cnv;
    }

    function buildTheme(n: DecorationOptions): Theme | null {
        if (n.theme !== "custom") return THEMES[n.theme] ?? null;
        const c = n.custom;
        const motion: Motion = c.direction === "up" ? "rise" : c.direction === "drift" ? "drift" : "fall";
        return { colors: [c.color], kinds: [{ shape: c.shape, weight: 1, min: 8, max: 16, motion, sway: motion === "drift" ? 0 : 14, spin: c.rotate }] };
    }

    function buildSprites() {
        if (!o || !theme) return;
        const key = [o.theme, o.colors?.join(), o.custom.shape, o.custom.color, image?.width, o.size, dpr].join("|");
        if (key === spriteKey) return;
        spriteKey = key;
        sprites = [];
        kindSprite = new Int16Array(kinds.length);
        kindSprites = new Int16Array(kinds.length);
        const custom = o.theme === "custom";
        for (let i = 0; i < kinds.length; i++) {
            const k = kinds[i];
            const glyph = k.shape === "flip" || k.shape === "image";
            const colors = glyph ? ["#ffffff"] : custom ? theme.colors : o.colors ?? k.colors ?? theme.colors;
            const res = Math.max(8, Math.min(128, Math.ceil(k.max * o.size * dpr)));
            kindSprite[i] = sprites.length;
            kindSprites[i] = colors.length;
            for (const c of colors) sprites.push(paint(k.shape, c, res));
        }
    }

    /* ---------- particles ---------- */

    function pickKind() {
        const r = Math.random() * cumWeight[cumWeight.length - 1];
        for (let i = 0; i < cumWeight.length; i++) if (r < cumWeight[i]) return i;
        return 0;
    }

    function spawn(i: number, anywhere: boolean) {
        const k = pickKind(), K = kinds[k], v = K.v ?? 1, s = rand(K.min, K.max) * o!.size;
        kd[i] = k;
        spr[i] = kindSprite[k] + Math.floor(Math.random() * kindSprites[k]);
        sz[i] = s;
        life[i] = 0;
        pushX[i] = pushY[i] = 0;
        rot[i] = K.spin ? rand(0, TAU) : 0;
        vr[i] = K.spin ? rand(-1.5, 1.5) : 0;
        ph[i] = rand(0, TAU);
        phs[i] = rand(0.6, 1.6);
        px[i] = rand(0, W);
        py[i] = anywhere ? rand(0, H) : 0;
        switch (K.motion) {
            case "fall":
                vx[i] = rand(-10, 10); vy[i] = rand(35, 70) * v;
                if (!anywhere) py[i] = -s;
                break;
            case "rise":
                vx[i] = rand(-8, 8); vy[i] = -rand(25, 50) * v;
                if (!anywhere) py[i] = H + s;
                break;
            case "drift": {
                const a = rand(0, TAU), m = rand(6, 22) * v;
                vx[i] = Math.cos(a) * m; vy[i] = Math.sin(a) * m;
                break;
            }
            case "bat": {
                const dir = Math.random() < 0.5 ? -1 : 1;
                vx[i] = dir * rand(70, 130) * v; vy[i] = rand(-12, 12);
                py[i] = rand(H * 0.08, H * 0.6);
                if (!anywhere) px[i] = dir > 0 ? -s : W + s;
                phs[i] = rand(5, 7); // wing beats
                break;
            }
        }
    }

    // short-lived particles thrown from a point; they fall with gravity and fade
    function burst(x: number, y: number, n: number, k: number) {
        if (k < 0) return;
        for (let j = 0; j < n && live < MAX; j++) {
            const i = live++;
            const K = kinds[k];
            kd[i] = k;
            spr[i] = kindSprite[k] + Math.floor(Math.random() * kindSprites[k]);
            sz[i] = rand(K.min, K.max) * o!.size * 0.8;
            px[i] = x; py[i] = y;
            vx[i] = rand(-120, 120); vy[i] = rand(-220, -60);
            pushX[i] = pushY[i] = 0;
            rot[i] = rand(0, TAU); vr[i] = rand(-6, 6);
            ph[i] = 0; phs[i] = 0;
            life[i] = rand(0.8, 1.4);
        }
    }

    /* ---------- set pieces ---------- */

    const garlandY = (x: number) => 2 + 13 * Math.abs(Math.sin(Math.PI * (x - LEFT_CLEAR) / SWAG));

    function addBulb(x: number, y: number, s: number) {
        if (bulbs >= bulbX.length || !free(x, y, 6)) return;
        bulbX[bulbs] = x; bulbY[bulbs] = y; bulbS[bulbs++] = s;
    }

    function garland(L: Ctx) {
        L.lineCap = "round";
        L.beginPath();
        for (let x = LEFT_CLEAR; x <= W - RIGHT_CLEAR; x += 3) L.lineTo(x, garlandY(x));
        L.strokeStyle = "#1d5e30";
        L.lineWidth = 7;
        L.stroke();
        L.setLineDash([2, 3]);
        L.strokeStyle = "#2f8a47";
        L.lineWidth = 3;
        L.stroke();
        L.setLineDash([]);
        L.fillStyle = "#d22b2b";
        for (let x = LEFT_CLEAR + 8; x < W - RIGHT_CLEAR; x += 26) {
            L.beginPath();
            L.arc(x, garlandY(x) + rnd() * 4 - 2, 2.2, 0, TAU);
            L.fill();
        }
        // bows where the swags hang from
        for (let x = LEFT_CLEAR; x <= W - RIGHT_CLEAR; x += SWAG) {
            L.beginPath();
            L.moveTo(x, 4); L.lineTo(x - 7, 0); L.lineTo(x - 7, 8);
            L.moveTo(x, 4); L.lineTo(x + 7, 0); L.lineTo(x + 7, 8);
            L.fill();
        }
    }

    function topLights(L: Ctx, onGarland: boolean) {
        const wy = (x: number) => onGarland ? garlandY(x) + 3 : 4 + 9 * Math.abs(Math.sin(Math.PI * x / 92));
        if (!onGarland) {
            L.beginPath();
            for (let x = LEFT_CLEAR; x <= W - RIGHT_CLEAR; x += 3) L.lineTo(x, wy(x));
            L.strokeStyle = "rgba(30,40,30,.9)";
            L.lineWidth = 1.5;
            L.stroke();
        }
        for (let x = LEFT_CLEAR + 14; x < W - RIGHT_CLEAR; x += 28) addBulb(x, wy(x) + 5, 1);
    }


    function web(L: Ctx, cx: number, cy: number, sx: number, sy: number, R: number) {
        const N = 7;
        L.strokeStyle = "rgba(225,225,235,.45)";
        L.lineWidth = 0.8;
        L.beginPath();
        for (let i = 0; i < N; i++) {
            const a = i / (N - 1) * Math.PI / 2;
            L.moveTo(cx, cy);
            L.lineTo(cx + sx * Math.cos(a) * R, cy + sy * Math.sin(a) * R);
        }
        // the spiral: threads between neighbouring spokes, sagging towards the corner
        for (let ring = 1; ring <= 6; ring++) {
            const rr = R * (ring + rnd() * 0.3) / 6.6;
            for (let i = 0; i < N - 1; i++) {
                const a0 = i / (N - 1) * Math.PI / 2, a1 = (i + 1) / (N - 1) * Math.PI / 2, am = (a0 + a1) / 2;
                L.moveTo(cx + sx * Math.cos(a0) * rr, cy + sy * Math.sin(a0) * rr);
                L.quadraticCurveTo(cx + sx * Math.cos(am) * rr * 0.86, cy + sy * Math.sin(am) * rr * 0.86, cx + sx * Math.cos(a1) * rr, cy + sy * Math.sin(a1) * rr);
            }
        }
        L.stroke();
    }

    function branch(L: Ctx, x: number, y: number, len: number, a: number, w: number, d: number) {
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        L.lineWidth = w;
        L.beginPath();
        L.moveTo(x, y);
        L.quadraticCurveTo(x + Math.cos(a + 0.25) * len * 0.5, y + Math.sin(a + 0.25) * len * 0.5, x2, y2);
        L.stroke();
        if (!d) return;
        const n = d > 4 ? 2 : 2 + (rnd() < 0.4 ? 1 : 0);
        for (let k = 0; k < n; k++) branch(L, x2, y2, len * (0.62 + rnd() * 0.18), a + (rnd() - 0.5) * 0.9 + (k - (n - 1) / 2) * 0.6, w * 0.65, d - 1);
    }

    function tree(L: Ctx, x: number, dir: number, base = H + 4, h = Math.min(240, H * 0.32)) {
        L.strokeStyle = L.fillStyle = "rgba(12,8,16,.8)";
        L.lineCap = "round";
        branch(L, x, base, h * 0.34, -Math.PI / 2 + dir * 0.18, h * 0.07, 6);
        L.beginPath();
        L.ellipse(x, base - 2, h * 0.22, 7, 0, Math.PI, TAU);
        L.fill();
    }

    function frost(L: Ctx, cx: number, cy: number, sx: number, R: number, sy = 1) {
        const gr = L.createRadialGradient(cx, cy, 0, cx, cy, R);
        gr.addColorStop(0, "rgba(220,240,255,.42)");
        gr.addColorStop(1, "rgba(220,240,255,0)");
        L.fillStyle = gr;
        L.beginPath();
        L.arc(cx, cy, R, 0, TAU);
        L.fill();
        // a few fern-like crystals growing out of the corner
        L.strokeStyle = "rgba(240,250,255,.5)";
        L.lineWidth = 0.8;
        L.beginPath();
        for (let k = 0; k < 7; k++) {
            const a = 0.25 + rnd() * (Math.PI / 2 - 0.5), len = R * (0.3 + rnd() * 0.45);
            const dx = sx * Math.cos(a), dy = sy * Math.sin(a);
            L.moveTo(cx, cy);
            L.lineTo(cx + dx * len, cy + dy * len);
            for (let j = 1; j <= 3; j++) {
                const bx = cx + dx * len * j / 4, by = cy + dy * len * j / 4, bl = len * 0.18;
                L.moveTo(bx, by); L.lineTo(bx + (dx * 0.5 - dy * 0.8) * bl, by + (dy * 0.5 + dx * 0.8) * bl);
                L.moveTo(bx, by); L.lineTo(bx + (dx * 0.5 + dy * 0.8) * bl, by + (dy * 0.5 - dx * 0.8) * bl);
            }
        }
        L.stroke();
    }

    function icicles(L: Ctx, x0: number, x1: number, y: number, max = 18) {
        L.fillStyle = "rgba(215,235,255,.82)";
        L.beginPath();
        for (let x = x0; x < x1; x += 6 + rnd() * 8) {
            const w = 3 + rnd() * 4, len = Math.min(max, rnd() < 0.15 ? 12 + rnd() * 6 : 3 + rnd() * 8);
            if (!free(x, y, len)) continue;
            L.moveTo(x, y); L.lineTo(x + w / 2, y + len); L.lineTo(x + w, y);
        }
        L.fill();
    }

    function snowman(L: Ctx, x: number, base: number) {
        L.fillStyle = "#f6fbff";
        L.strokeStyle = "rgba(120,150,190,.6)";
        L.lineWidth = 1;
        for (const [dy, r] of [[-14, 14], [-36, 10], [-52, 7]]) {
            L.beginPath(); L.arc(x, base + dy, r, 0, TAU); L.fill(); L.stroke();
        }
        L.fillStyle = "#c62828"; // scarf
        L.fillRect(x - 9, base - 46, 18, 4);
        L.fillRect(x + 3, base - 46, 4, 11);
        L.fillStyle = "#1b1b1b"; // hat, eyes, buttons
        L.fillRect(x - 9, base - 59, 18, 2.5);
        L.fillRect(x - 6, base - 71, 12, 12);
        for (const [ex, ey] of [[-2.5, -54], [2.5, -54], [0, -38], [0, -31]]) { L.beginPath(); L.arc(x + ex, base + ey, 1.2, 0, TAU); L.fill(); }
        L.fillStyle = "#f08a24"; // nose
        L.beginPath(); L.moveTo(x, base - 52); L.lineTo(x + 8, base - 50.5); L.lineTo(x, base - 49.5); L.fill();
    }

    function palm(L: Ctx, bx = W - 50, dir = 1, base = H, h = Math.min(240, H * 0.32)) {
        const tx = bx - dir * h * 0.35, ty = base - h;
        L.strokeStyle = L.fillStyle = "rgba(20,58,36,.82)";
        L.lineCap = "round";
        L.lineWidth = 9;
        L.beginPath(); L.moveTo(bx, base + 5); L.quadraticCurveTo(bx - dir * h * 0.05, base - h * 0.55, tx, ty); L.stroke();
        for (let k = 0; k < 7; k++) {
            const a = -Math.PI * (0.95 - k * 0.15), len = h * (0.45 + rnd() * 0.15);
            const ex = tx + dir * Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.6 + len * 0.35;
            const qx = tx + dir * Math.cos(a) * len * 0.55, qy = ty + Math.sin(a) * len * 0.55 - 6;
            L.beginPath(); L.moveTo(tx, ty); L.quadraticCurveTo(qx, qy - 8, ex, ey); L.quadraticCurveTo(qx, qy + 8, tx, ty); L.fill();
        }
        L.beginPath(); L.arc(tx - 4, ty + 6, 5, 0, TAU); L.arc(tx + 6, ty + 7, 5, 0, TAU); L.fill();
    }

    function bunting(L: Ctx, colors: string[]) {
        const by = (x: number) => 3 + 16 * Math.abs(Math.sin(Math.PI * (x - LEFT_CLEAR) / 160));
        L.beginPath();
        for (let x = LEFT_CLEAR; x <= W - RIGHT_CLEAR; x += 3) L.lineTo(x, by(x));
        L.strokeStyle = "rgba(240,240,240,.8)";
        L.lineWidth = 1.2;
        L.stroke();
        let k = 0;
        for (let x = LEFT_CLEAR + 12; x < W - RIGHT_CLEAR - 8; x += 22) {
            L.fillStyle = colors[k++ % colors.length];
            L.beginPath(); L.moveTo(x - 8, by(x - 8)); L.lineTo(x + 8, by(x + 8)); L.lineTo(x, by(x) + 17); L.fill();
        }
    }

    function propSprites() {
        const p = sp(28, 28), f = sp(28, 28), s = 28;
        p.fillStyle = "#e8740f";
        p.beginPath(); p.ellipse(s * 0.5, s * 0.6, s * 0.44, s * 0.34, 0, 0, TAU); p.fill();
        p.fillStyle = "#f28a1e";
        p.beginPath(); p.ellipse(s * 0.5, s * 0.6, s * 0.2, s * 0.34, 0, 0, TAU); p.fill();
        p.strokeStyle = "rgba(120,40,0,.5)";
        p.beginPath(); p.ellipse(s * 0.5, s * 0.6, s * 0.32, s * 0.34, 0, 0, TAU); p.stroke();
        p.fillStyle = "#4a6b1f";
        p.fillRect(s * 0.46, s * 0.15, s * 0.09, s * 0.15);
        // the carved face: dark on the body, glowing on its own sprite (flickers on top)
        const F = [0.3, 0.52, 0.42, 0.52, 0.36, 0.42, 0.58, 0.52, 0.7, 0.52, 0.64, 0.42, 0.47, 0.6, 0.53, 0.6, 0.5, 0.55];
        const M = [0.28, 0.66, 0.36, 0.72, 0.42, 0.68, 0.5, 0.74, 0.58, 0.68, 0.64, 0.72, 0.72, 0.66, 0.62, 0.8, 0.38, 0.8];
        for (const c of [p, f]) {
            c.fillStyle = c === p ? "#2a0f00" : "#ffd34d";
            if (c === f) { c.shadowColor = "#ff9a00"; c.shadowBlur = 4; }
            c.beginPath();
            for (let i = 0; i < F.length; i += 6) { c.moveTo(F[i] * s, F[i + 1] * s); c.lineTo(F[i + 2] * s, F[i + 3] * s); c.lineTo(F[i + 4] * s, F[i + 5] * s); c.closePath(); }
            c.moveTo(M[0] * s, M[1] * s);
            for (let i = 2; i < M.length; i += 2) c.lineTo(M[i] * s, M[i + 1] * s);
            c.closePath();
            c.fill();
        }
        pkBody = p.canvas; pkFace = f.canvas;
        const w = sp(70, 70);
        glow(w, 35, 35, 35, "#ff9a1f", 0);
        warm = w.canvas;

        const d = sp(22, 22);
        d.shadowColor = "rgba(200,180,255,.7)";
        d.shadowBlur = 2;
        d.strokeStyle = d.fillStyle = "#141014";
        d.lineWidth = 1.2;
        d.beginPath();
        for (let i = 0; i < 4; i++) {
            for (const sx of [-1, 1]) {
                d.moveTo(11 + sx * 2, 10 + i * 1.6);
                d.lineTo(11 + sx * 8, 5 + i * 3);
                d.lineTo(11 + sx * 10, 9 + i * 3.4);
            }
        }
        d.stroke();
        d.beginPath(); d.ellipse(11, 12, 4, 5, 0, 0, TAU); d.fill();
        d.beginPath(); d.arc(11, 6.5, 2.6, 0, TAU); d.fill();
        d.fillStyle = "#ff3030";
        d.fillRect(9.6, 5.6, 1, 1); d.fillRect(11.4, 5.6, 1, 1);
        spider = d.canvas;

        const u = sp(360, 360);
        u.translate(180, 180);
        const gr = u.createRadialGradient(0, 0, 0, 0, 0, 180);
        gr.addColorStop(0, "rgba(255,220,120,.4)");
        gr.addColorStop(1, "rgba(255,220,120,0)");
        u.fillStyle = gr;
        for (let i = 0; i < 14; i++) {
            u.rotate(TAU / 14);
            u.beginPath(); u.moveTo(0, 0); u.lineTo(180, -12); u.lineTo(180, 12); u.fill();
        }
        glow(u, 0, 0, 90, "#ffd76a", 1);
        sun = u.canvas;

        const b = sp(44, 60);
        b.fillStyle = "#f4f1ee";
        b.strokeStyle = "rgba(0,0,0,.25)";
        for (const ex of [15, 29]) { b.beginPath(); b.ellipse(ex, 16, 5, 14, ex < 22 ? -0.15 : 0.15, 0, TAU); b.fill(); b.stroke(); }
        b.fillStyle = "#f6b6c8";
        for (const ex of [15, 29]) { b.beginPath(); b.ellipse(ex, 17, 2.2, 10, ex < 22 ? -0.15 : 0.15, 0, TAU); b.fill(); }
        b.fillStyle = "#f4f1ee";
        b.beginPath(); b.ellipse(22, 42, 16, 14, 0, 0, TAU); b.fill(); b.stroke();
        b.fillStyle = "#222";
        b.beginPath(); b.arc(16, 40, 2, 0, TAU); b.arc(28, 40, 2, 0, TAU); b.fill();
        b.fillStyle = "#f08aa8";
        b.beginPath(); b.arc(22, 46, 1.8, 0, TAU); b.fill();
        bunny = b.canvas;

        const e = sp(20, 20);
        e.fillStyle = "#fff"; e.strokeStyle = "#222"; e.lineWidth = 1.5;
        e.beginPath(); e.arc(10, 10, 9, 0, TAU); e.fill(); e.stroke();
        eyeWhite = e.canvas;
        const q = sp(10, 10);
        q.fillStyle = "#111";
        q.beginPath(); q.arc(5, 5, 4.6, 0, TAU); q.fill();
        q.fillStyle = "#fff";
        q.beginPath(); q.arc(3.4, 3.4, 1.2, 0, TAU); q.fill();
        pupil = q.canvas;
    }

    function ornament(len: number, color: string) {
        const c = sp(18, len + 22);
        c.strokeStyle = "rgba(220,220,220,.7)";
        c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(9, 0); c.lineTo(9, len); c.stroke();
        c.fillStyle = "#d4af37";
        c.fillRect(6, len, 6, 4);
        c.fillStyle = color;
        c.beginPath(); c.arc(9, len + 12, 8, 0, TAU); c.fill();
        c.fillStyle = "rgba(255,255,255,.45)";
        c.beginPath(); c.arc(6.5, len + 9, 2.4, 0, TAU); c.fill();
        return c.canvas;
    }

    /* ---------- the zones ---------- */

    // draw inside a zone's rounded card only, so corner pieces follow its curve instead of poking out
    function inZone(L: Ctx, k: number, draw: () => void) {
        if (!zon(k)) return;
        L.save();
        L.beginPath();
        L.roundRect(zx(k), zy(k), zw(k), zh(k), Math.max(12, zr(k)));
        L.clip();
        draw();
        L.restore();
    }

    // soft frost growing out of every corner of a zone (inset by the corner's curve)
    function frostZone(L: Ctx, k: number, R: number, bottom = true) {
        inZone(L, k, () => {
            // start inside the curve, so the frost sits in the corner instead of outlining it
            const x0 = zx(k), y0 = zy(k), x1 = x0 + zw(k), y1 = y0 + zh(k), i = Math.max(12, zr(k)) * 0.45;
            frost(L, x0 + i, y0 + i, 1, R); frost(L, x1 - i, y0 + i, -1, R);
            if (bottom) { frost(L, x0 + i, y1 - i, 1, R, -1); frost(L, x1 - i, y1 - i, -1, R, -1); }
        });
    }

    function webZone(L: Ctx, k: number, R: number, bottom: boolean) {
        inZone(L, k, () => {
            const x0 = zx(k), y0 = zy(k), x1 = x0 + zw(k), y1 = y0 + zh(k);
            web(L, x0, y0, 1, 1, R); web(L, x1, y0, -1, 1, R);
            if (bottom) { web(L, x0, y1, 1, -1, R * 0.7); web(L, x1, y1, -1, -1, R * 0.7); }
        });
    }

    // icicles hang from a zone's top edge, between its rounded corners
    const iciclesZone = (L: Ctx, k: number) => { if (zon(k)) icicles(L, zx(k) + zr(k), zx(k) + zw(k) - zr(k), zy(k), 10); };

    function lightsZone(k: number) {
        if (!zon(k)) return;
        const l = zx(k) + zr(k) + 6, r = zx(k) + zw(k) - zr(k) - 6, top = zy(k);
        for (let x = l; x < r; x += 30) addBulb(x, top + 1, 0.65);
    }

    // where a corner piece stands: the chat's bottom right corner, on top of the message box if there is one
    function cornerSpot(): [number, number] {
        if (zon(2)) {
            const right = zx(2) + zw(2) - Math.max(6, zr(2) * 0.5);
            if (zon(3) && zy(3) > zy(2) + zh(2) * 0.5) return [Math.min(right, zx(3) + zw(3)), zy(3) - 2];
            return [right, zy(2) + zh(2) - Math.max(3, zr(2) * 0.25)];
        }
        return [W - 10, H - 4];
    }

    // the tree's and the palm's pictures: wide enough for every branch and frond (they were cut off at 150 px)
    const TREE_W = 290, TREE_H = 200, TREE_X = 185;
    const PALM_W = 280, PALM_H = 240, PALM_X = 220;

    function setCornerPiece(w: number, h: number, draw: (c: Ctx) => void) {
        const c = sp(w, h);
        draw(c);
        cornerPiece = c.canvas;
        const [r, b] = cornerSpot();
        cpX = r - w; cpY = b - h; cpW = w; cpH = h;
    }

    function buildLayer() {
        bulbs = pumpkins = ornaments = balloons = eyes = 0;
        spOn = bunnyOn = false;
        layerEmpty = true;
        if (!g || !cv || !o || !W) return;
        if (!layer || layer.width !== cv.width || layer.height !== cv.height) layer = new OffscreenCanvas(cv.width, cv.height);
        const L = layer.getContext("2d")!;
        L.setTransform(1, 0, 0, 1, 0, 0);
        L.clearRect(0, 0, layer.width, layer.height);
        L.setTransform(dpr, 0, 0, dpr, 0, 0);
        seed = 12345;
        const th = o.theme, big: number[] = [];
        for (let i = 0; i < mN; i++) if (mW[i] >= 100 && mH[i] >= 100 && mY[i] >= 0) big.push(i);
        const lightColors = o.colors ?? LIGHTS;
        glowSprites = lightColors.map(c => paint("glow", c, Math.ceil(28 * dpr)));
        bulbSprites = lightColors.map(c => paint("petal", c, Math.ceil(12 * dpr)));
        if (props) propSprites();

        cornerPiece = null;
        if (th === "christmas") {
            if (props) {
                garland(L);
                for (let x = LEFT_CLEAR + SWAG / 2, k = 0; x < W - RIGHT_CLEAR && ornaments < orX.length; x += SWAG * 2, k++) {
                    const len = 14 + rnd() * 30;
                    orX[ornaments] = x; orY[ornaments] = garlandY(x) + 2; orH[ornaments] = len + 22;
                    orSprites[ornaments++] = ornament(len, ORNAMENTS[k % ORNAMENTS.length]);
                }
                // frost only in your lists' and the chat's corners, icicles only on your lists
                frostZone(L, 0, 46); frostZone(L, 1, 40); frostZone(L, 2, 52);
                iciclesZone(L, 0); iciclesZone(L, 1);
                setCornerPiece(40, 74, c => snowman(c, 20, 73));
            }
            if (o.lights) {
                topLights(L, props);
                lightsZone(0); lightsZone(1);
            }
        } else if (th === "winter" && props) {
            icicles(L, LEFT_CLEAR, W - RIGHT_CLEAR, 0);
            frostZone(L, 0, 50); frostZone(L, 1, 42); frostZone(L, 2, 56);
            iciclesZone(L, 0); iciclesZone(L, 1);
            setCornerPiece(40, 74, c => snowman(c, 20, 73));
        } else if (th === "halloween" && props) {
            // the same web in the same corners every time: your lists' top corners and every corner of the chat
            webZone(L, 0, 64, false); webZone(L, 1, 48, false); webZone(L, 2, 70, true);
            // pumpkins on top of your profile panel and by the tree
            if (zon(1)) for (const f of [0.18, 0.34]) { pkX[pumpkins] = zx(1) + zw(1) * f; pkY[pumpkins++] = zy(1); }
            setCornerPiece(TREE_W, TREE_H, c => tree(c, TREE_X, -1, TREE_H - 2, 150));
            { const [r, b] = cornerSpot(); for (const dx of [-120, -92]) if (pumpkins < pkX.length) { pkX[pumpkins] = r + dx; pkY[pumpkins++] = b; } }
            spOn = true;
            if (zon(2)) { spX = zx(2) + zw(2) * 0.72; spTop = zy(2); } else { spX = W * 0.6; spTop = TOP_CLEAR; }
        } else if (th === "easter" && props) {
            const eggs = (o.colors ?? THEMES.easter.colors).map(c => paint("egg", c, Math.ceil(16 * dpr)));
            let k = 0;
            for (const i of big) {
                for (let n = 0; n < 3; n++) {
                    const x = mX[i] + 16 + rnd() * (mW[i] - 32);
                    if (free(x, mY[i], 16)) L.drawImage(eggs[k++ % eggs.length], x - 8, mY[i] - 15.5, 16, 16);
                }
                if (mH[i] >= 300 && mX[i] > 120) for (let n = 0; n < 4; n++) {
                    const x = mX[i] + 16 + rnd() * (mW[i] - 32), y = Math.min(H - 2, mY[i] + mH[i]);
                    L.drawImage(eggs[k++ % eggs.length], x - 9, y - 17.5, 18, 18);
                }
            }
            bunnyOn = true;
        } else if (th === "summer" && props) {
            setCornerPiece(PALM_W, PALM_H, c => palm(c, PALM_X, 1, PALM_H - 4, 165));
        } else if (th === "birthday" && props) {
            const colors = o.colors ?? CONFETTI;
            bunting(L, colors);
            bbSprites = [];
            const OFF = [-24, -118, 0, -140, 24, -116, -6, -96];
            // one bunch standing in the chat's corner, clear of your profile panel
            const [cr, cb] = cornerSpot();
            for (const ax of [cr - 40]) {
                for (let j = 0; j < OFF.length && balloons < bbX.length; j += 2) {
                    bbAX[balloons] = ax; bbAY[balloons] = cb;
                    bbX[balloons] = ax + OFF[j]; bbY[balloons] = cb + OFF[j + 1];
                    bbPop[balloons] = 0;
                    bbSprites[balloons] = paint("balloon", colors[balloons % colors.length], Math.ceil(38 * dpr));
                    balloons++;
                }
            }
        } else if (th === "autumn" && props) {
            setCornerPiece(TREE_W, TREE_H, c => tree(c, TREE_X, -1, TREE_H - 2, 150));
            { const [r, b] = cornerSpot(); for (const dx of [-120, -92]) { pkX[pumpkins] = r + dx; pkY[pumpkins++] = b; } }
            if (zon(1)) for (const f of [0.18, 0.34]) { pkX[pumpkins] = zx(1) + zw(1) * f; pkY[pumpkins++] = zy(1); }
        } else if (th === "aprilfools" && props) {
            for (const i of big) {
                if (eyes + 2 > eyX.length || rnd() < 0.3) continue;
                const x = mX[i] + mW[i] - 44, y = mY[i] + 20;
                if (!free(x, y, 30)) continue;
                for (const dx of [0, 22]) { eyX[eyes] = x + dx; eyY[eyes] = y; eyOX[eyes] = eyOY[eyes] = eyVX[eyes] = eyVY[eyes] = 0; eyes++; }
            }
        }
        layerEmpty = th === "custom" || th === "aprilfools" || (!props && !(th === "christmas" && o.lights));
    }

    /* ---------- surfaces ---------- */

    function setRects(main: Float32Array, small: Float32Array, chat: Float32Array | null, zones?: Float32Array) {
        Z.fill(0);
        if (zones) Z.set(zones.subarray(0, Z.length));
        mN = Math.min(MAX_MAIN, main.length / 4);
        for (let i = 0; i < mN; i++) { mX[i] = main[i * 4]; mY[i] = main[i * 4 + 1]; mW[i] = main[i * 4 + 2]; mH[i] = main[i * 4 + 3]; }
        if (chat) { cX = chat[0]; cY = chat[1]; cW = chat[2]; cH = chat[3]; } else cW = 0;
        let n = 0;
        for (const list of [main, small]) {
            for (let j = 0; j + 3 < list.length && n < MAX_SURF; j += 4) {
                const left = list[j], top = list[j + 1], w = Math.min(list[j + 2], COLS * COL);
                if (w < 28 || top < 8 || top > H - 20) continue;
                // the surface moved or resized: its pile goes
                if (Math.abs(sL[n] - left) > 2 || Math.abs(sT[n] - top) > 2 || Math.abs(sW[n] - w) > 2) heights.fill(0, n * COLS, (n + 1) * COLS);
                sL[n] = left; sT[n] = top; sW[n] = w;
                n++;
            }
        }
        floors = n;
        // the floor of every tall panel, so piles grow at the bottom of the screen too (not only on top edges)
        for (let i = 0; i < mN && n < MAX_SURF; i++) {
            const left = mX[i], top = Math.min(H - 2, mY[i] + mH[i]), w = Math.min(mW[i], COLS * COL);
            if (mH[i] < 300 || w < 28) continue;
            if (Math.abs(sL[n] - left) > 2 || Math.abs(sT[n] - top) > 2 || Math.abs(sW[n] - w) > 2) heights.fill(0, n * COLS, (n + 1) * COLS);
            sL[n] = left; sT[n] = top; sW[n] = w;
            n++;
        }
        for (let p = n; p < sN; p++) heights.fill(0, p * COLS, (p + 1) * COLS);
        sN = n;
        buildLayer();
    }

    /* ---------- the frame ---------- */

    function update(dt: number) {
        const op = o!, sp2 = op.speed, decay = Math.exp(-3 * dt), mouse = op.mouse && mouseIn;
        if (theme!.gusts) {
            gustT -= dt;
            if (gustT <= 0) { gustT = rand(8, 15); gustAge = 0; gustA = rand(70, 150) * (Math.random() < 0.5 ? -1 : 1); }
            gustAge += dt;
            wind = gustAge < 4 ? gustA * Math.sin(Math.PI * gustAge / 4) : 0;
        } else wind = 0;
        const lands = piling && sN > 0;
        for (let i = 0; i < live; i++) {
            const K = kinds[kd[i]];
            if (life[i] > 0) {
                life[i] -= dt;
                vy[i] += 400 * dt;
                px[i] += vx[i] * dt; py[i] += vy[i] * dt; rot[i] += vr[i] * dt;
                if (life[i] <= 0 || py[i] > H + 20) {
                    const j = --live;
                    px[i] = px[j]; py[i] = py[j]; vx[i] = vx[j]; vy[i] = vy[j]; rot[i] = rot[j]; vr[i] = vr[j];
                    sz[i] = sz[j]; life[i] = life[j]; kd[i] = kd[j]; spr[i] = spr[j];
                    i--;
                }
                continue;
            }
            ph[i] += phs[i] * dt;
            const bat = K.motion === "bat";
            if (K.spin) rot[i] += vr[i] * dt * sp2 * (1 + Math.abs(wind) / 50);
            const sway = K.sway ? Math.sin(ph[i]) * K.sway : 0;
            if (mouse) {
                const dx = px[i] - mx, dy = py[i] - my, d = Math.hypot(dx, dy);
                if (d < MOUSE_R && d > 0.5) {
                    if (K.pops && d < sz[i] * 0.45) {
                        burst(px[i], py[i], 10, burstPop);
                        spawn(i, false);
                        continue;
                    }
                    const f = (1 - d / MOUSE_R) * 900 * dt;
                    pushX[i] += dx / d * f; pushY[i] += dy / d * f;
                }
            }
            pushX[i] *= decay; pushY[i] *= decay;
            const x = px[i] += (vx[i] + sway) * sp2 * dt + pushX[i] * dt + (bat ? 0 : wind * dt);
            const y = py[i] += vy[i] * sp2 * dt + pushY[i] * dt;
            const s = sz[i];
            if (K.lands && lands && vy[i] > 0) {
                let landed = false;
                for (let p = 0; p < sN; p++) {
                    const lx = x - sL[p], top = sT[p];
                    if (lx < 0 || lx >= sW[p] || y > top + 8) continue;
                    const c = p * COLS + (lx / COL | 0);
                    if (y < top - heights[c]) continue;
                    // edges catch about 1 flake in 6 (different ones per edge), so snow reaches all the way down
                    if (p < floors && (i * 31 + p * 17 + (lx / 40 | 0)) % 6) continue;
                    // floors stay low, so a pile never covers what you type at the bottom of the chat
                    const cap = p < floors ? PILE_MAX : 11;
                    heights[c] = Math.min(cap, heights[c] + s * 0.3);
                    if (lx >= COL) heights[c - 1] = Math.min(cap, heights[c - 1] + s * 0.1);
                    if (lx + COL < sW[p]) heights[c + 1] = Math.min(cap, heights[c + 1] + s * 0.1);
                    landed = true;
                    break;
                }
                if (landed) { spawn(i, false); continue; }
            }
            if (K.motion === "drift") {
                if (x < -s) px[i] = W + s; else if (x > W + s) px[i] = -s;
                if (y < -s) py[i] = H + s; else if (y > H + s) py[i] = -s;
            } else if (y > H + s * 2 || y < -s * 2 || x < -s * 3 || x > W + s * 3) spawn(i, false);
        }
        if (lands) piles(dt, mouse);
        if (props) updateProps(dt, mouse);
        pmx = mx; pmy = my;
    }

    function piles(dt: number, mouse: boolean) {
        const melt = MELT * dt;
        const sweep = mouse && Math.hypot(mx - pmx, my - pmy) > 2;
        let swept = 0;
        for (let p = 0; p < sN; p++) {
            const base = p * COLS, cols = Math.ceil(sW[p] / COL), top = sT[p];
            for (let c = 0; c < cols; c++) if (heights[base + c] > 0) heights[base + c] = Math.max(0, heights[base + c] - melt);
            if (!sweep || my < top - PILE_MAX - 12 || my > top + 12 || mx < sL[p] || mx > sL[p] + sW[p]) continue;
            const mc = (mx - sL[p]) / COL | 0;
            for (let c = Math.max(0, mc - 6); c <= Math.min(cols - 1, mc + 6); c++) {
                const take = heights[base + c] * 0.6;
                heights[base + c] -= take;
                swept += take;
            }
        }
        if (swept > 2) burst(mx, my - 4, Math.min(5, swept / 4 | 0) || 1, burstPile);
    }

    function updateProps(dt: number, mouse: boolean) {
        if (cornerPiece) {
            // 80% see-through while the mouse is over it, easing in and out
            const over = mouseIn && mx > cpX - 8 && mx < cpX + cpW + 8 && my > cpY - 8 && my < cpY + cpH + 8;
            cpA += ((over ? 0.2 : 1) - cpA) * Math.min(1, dt * 8);
        }
        if (spOn) {
            const sy = spTop + spLen;
            // the spider goes back up, fast, when the mouse comes close
            if (mouse && spState && spState < 3 && Math.hypot(mx - spX, my - sy) < 80) { spState = 3; spFlee = true; }
            if (spState === 0) {
                spTimer -= dt;
                if (spTimer <= 0) { spState = 1; spTarget = rand(60, Math.min(220, H * 0.35)); }
            } else if (spState === 1) {
                spLen += 40 * dt;
                if (spLen >= spTarget) { spState = 2; spTimer = rand(4, 8); }
            } else if (spState === 2) {
                spTimer -= dt;
                if (spTimer <= 0) spState = 3;
            } else {
                spLen -= (spFlee ? 260 : 70) * dt;
                if (spLen <= 0) { spLen = 0; spState = 0; spFlee = false; spTimer = rand(10, 20); }
            }
        }
        if (bunnyOn) {
            const p = t % 14;
            let target = p < 1 ? p : p < 5 ? 1 : p < 6 ? 6 - p : 0;
            if (mouse && Math.hypot(mx - 38, my - H) < 90) target = 0;
            bunnyShow += (target - bunnyShow) * Math.min(1, dt * 5);
        }
        for (let b = 0; b < balloons; b++) {
            if (bbPop[b] > 0) { bbPop[b] -= dt; continue; }
            const bx = bbX[b] + Math.sin(t * 0.9 + b * 2) * 3, by = bbY[b] + Math.sin(t * 1.2 + b) * 4 - 4;
            if (mouse && Math.hypot(mx - bx, my - by) < 14) { bbPop[b] = 6; burst(bx, by, 12, burstPop); }
        }
        if (eyes) {
            eyeKick -= dt;
            const kick = eyeKick <= 0;
            if (kick) eyeKick = rand(3, 6);
            const fx = (mx - pmx) * 6, fy = (my - pmy) * 6;
            for (let e = 0; e < eyes; e++) {
                let tx = 0, ty = 2.5;
                if (mouseIn) {
                    const dx = mx - eyX[e], dy = my - eyY[e], d = Math.hypot(dx, dy) || 1;
                    tx = dx / d * 4; ty = dy / d * 4;
                    eyVX[e] -= fx * dt * 8; eyVY[e] -= fy * dt * 8;
                }
                if (kick) { eyVX[e] += rand(-60, 60); eyVY[e] += rand(-60, 20); }
                eyVX[e] += ((tx - eyOX[e]) * 60 - eyVX[e] * 5) * dt;
                eyVY[e] += ((ty - eyOY[e]) * 60 - eyVY[e] * 5) * dt;
                eyOX[e] += eyVX[e] * dt; eyOY[e] += eyVY[e] * dt;
                const d = Math.hypot(eyOX[e], eyOY[e]);
                if (d > 4.5) { eyOX[e] *= 4.5 / d; eyOY[e] *= 4.5 / d; eyVX[e] *= -0.4; eyVY[e] *= -0.4; }
            }
        }
    }

    function drawProps(c: Ctx) {
        if (bulbs) {
            const n = glowSprites.length, step = Math.floor(t / 0.7);
            for (let b = 0; b < bulbs; b++) {
                const ci = (b + step) % n, s = bulbS[b], x = bulbX[b], y = bulbY[b];
                c.globalAlpha = 0.5 + 0.45 * Math.abs(Math.sin(t * 1.1 + b));
                c.drawImage(glowSprites[ci], x - 14 * s, y - 14 * s, 28 * s, 28 * s);
                c.globalAlpha = 1;
                c.drawImage(bulbSprites[ci], x - 6 * s, y - 6 * s, 12 * s, 12 * s);
            }
        }
        for (let k = 0; k < ornaments; k++) {
            const a = 0.12 * Math.sin(t * 1.3 + k * 1.7), cs = Math.cos(a) * dpr, sn = Math.sin(a) * dpr;
            c.setTransform(cs, sn, -sn, cs, orX[k] * dpr, orY[k] * dpr);
            c.drawImage(orSprites[k], -9, 0, 18, orH[k]);
        }
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (cornerPiece) {
            c.globalAlpha = cpA;
            c.drawImage(cornerPiece, cpX, cpY, cpW, cpH);
        }
        for (let k = 0; k < pumpkins; k++) {
            const f = 0.65 + 0.2 * Math.sin(t * 13 + k) + 0.15 * Math.sin(t * 31 + k * 2), x = pkX[k], y = pkY[k];
            // anything you point at fades away, so it never hides what's under it
            const near = mouseIn && Math.abs(mx - x) < 30 && my > y - 40 && my < y + 10 ? 0.2 : 1;
            c.globalAlpha = f * 0.4 * near;
            c.drawImage(warm!, x - 35, y - 47, 70, 70);
            c.globalAlpha = near;
            c.drawImage(pkBody!, x - 14, y - 26, 28, 28);
            c.globalAlpha = f * near;
            c.drawImage(pkFace!, x - 14, y - 26, 28, 28);
        }
        c.globalAlpha = 1;
        if (spOn && spLen > 0) {
            const x = spX + Math.sin(t * 1.4) * 3, y = spTop + spLen;
            c.strokeStyle = "rgba(230,230,240,.55)";
            c.lineWidth = 0.8;
            c.beginPath(); c.moveTo(spX, spTop); c.lineTo(x, y); c.stroke();
            c.drawImage(spider!, x - 11, y - 4, 22, 22);
        }
        if (sun && o!.theme === "summer" && props) {
            const a = t * 0.05, cs = Math.cos(a) * dpr, sn = Math.sin(a) * dpr;
            c.globalAlpha = 0.6;
            c.setTransform(cs, sn, -sn, cs, (W - 300) * dpr, -40 * dpr);
            c.drawImage(sun, -180, -180, 360, 360);
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            c.globalAlpha = 1;
        }
        if (bunnyOn && bunnyShow > 0.01) c.drawImage(bunny!, W - 70, H + 2 - bunnyShow * 50, 44, 60);
        if (balloons) {
            c.strokeStyle = "rgba(255,255,255,.5)";
            c.lineWidth = 1;
            c.beginPath();
            for (let b = 0; b < balloons; b++) {
                if (bbPop[b] > 0) continue;
                const bx = bbX[b] + Math.sin(t * 0.9 + b * 2) * 3, by = bbY[b] + Math.sin(t * 1.2 + b) * 4;
                c.moveTo(bx, by + 10); c.quadraticCurveTo(bx + 6, (by + bbAY[b]) / 2, bbAX[b], bbAY[b]);
            }
            c.stroke();
            for (let b = 0; b < balloons; b++) {
                if (bbPop[b] > 0) continue;
                const bx = bbX[b] + Math.sin(t * 0.9 + b * 2) * 3, by = bbY[b] + Math.sin(t * 1.2 + b) * 4;
                c.drawImage(bbSprites[b], bx - 19, by - 19, 38, 38);
            }
        }
        for (let e = 0; e < eyes; e++) {
            c.drawImage(eyeWhite!, eyX[e] - 10, eyY[e] - 10, 20, 20);
            c.drawImage(pupil!, eyX[e] + eyOX[e] - 5, eyY[e] + eyOY[e] - 5, 10, 10);
        }
    }

    function drawPiles(c: Ctx) {
        const leaves = theme!.pile === "leaves";
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.globalAlpha = 0.92;
        c.fillStyle = leaves ? "#8f4316" : "#f4faff";
        for (let p = 0; p < sN; p++) {
            const base = p * COLS, cols = Math.ceil(sW[p] / COL), left = sL[p], top = sT[p];
            c.beginPath();
            c.moveTo(left, top);
            for (let k = 0; k < cols; k++) c.lineTo(left + k * COL + COL / 2, top - heights[base + k]);
            c.lineTo(left + sW[p], top);
            c.fill();
        }
        if (!leaves || burstPile < 0) return;
        // a few whole leaves on top of each leaf pile
        const first = kindSprite[burstPile], n = kindSprites[burstPile];
        c.globalAlpha = 1;
        for (let p = 0; p < sN; p++) {
            const base = p * COLS, cols = Math.ceil(sW[p] / COL);
            for (let k = 1; k < cols; k += 3) {
                const h = heights[base + k];
                if (h < 3) continue;
                const a = k * 1.7, s = 9 * dpr, cs = Math.cos(a) * s, sn = Math.sin(a) * s;
                c.setTransform(cs, sn, -sn, cs, (sL[p] + k * COL) * dpr, (sT[p] - h + 2) * dpr);
                c.drawImage(sprites[first + k % n], -0.5, -0.5, 1, 1);
            }
        }
    }

    function draw() {
        const c = g!;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.clearRect(0, 0, cv!.width, cv!.height);
        if (layer && !layerEmpty) c.drawImage(layer, 0, 0);
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawProps(c);
        // nothing that stays put covers the window buttons or the back / forward arrows
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.clearRect(0, 0, LEFT_CLEAR * dpr, TOP_CLEAR * dpr);
        c.clearRect((W - RIGHT_CLEAR) * dpr, 0, RIGHT_CLEAR * dpr, TOP_CLEAR * dpr);
        for (let i = 0; i < live; i++) {
            const K = kinds[kd[i]], x = px[i], y = py[i];
            let a = (K.alpha ?? 1) * ALPHA;
            if (life[i] > 0) a *= Math.min(1, life[i] * 2);
            else if (K.twinkle) a *= 0.55 + 0.45 * Math.sin(ph[i] * 2);
            if (cW > 0 && x > cX && x < cX + cW && y > cY && y < cY + cH) a *= 0.6;
            const s = sz[i] * dpr, cs = Math.cos(rot[i]) * s, sn = Math.sin(rot[i]) * s;
            const fy = K.motion === "bat" ? 0.35 + 0.65 * Math.abs(Math.sin(ph[i])) : 1;
            c.globalAlpha = a;
            // unit square scaled, rotated and moved in one transform: no state objects per particle
            c.setTransform(cs, sn, -sn * fy, cs * fy, x * dpr, y * dpr);
            c.drawImage(sprites[spr[i]], -0.5, -0.5, 1, 1);
        }
        if (piling && sN) drawPiles(c);
    }

    // The next frame is only asked for when it's due (60 a second): a frame request always pending would run at
    // the monitor's rate (240 Hz on a 240 Hz screen).
    const hasRaf = typeof requestAnimationFrame === "function";
    function schedule() {
        const delay = Math.max(0, FPS_STEP - (performance.now() - lastFrame) - 2);
        timer = setTimeout(() => {
            timer = 0;
            if (!running) return;
            if (hasRaf) raf = requestAnimationFrame(frame);
            else frame(performance.now());
        }, delay) as unknown as number;
    }
    function frame(now: number) {
        raf = 0;
        if (!running || !g || !o) return;
        lastFrame = now;
        schedule();
        const dt = Math.min(now - last, 50) / 1000;
        last = now;
        t += dt;
        update(dt);
        draw();
    }
    function setRunning(on: boolean) {
        if (on === running) return;
        running = on;
        if (on) { last = lastFrame = performance.now(); schedule(); return; }
        clearTimeout(timer);
        if (raf) cancelAnimationFrame(raf);
        timer = raf = 0;
    }

    function setOpts(n: DecorationOptions) {
        const th = buildTheme(n);
        if (!th) return;
        o = n;
        theme = th;
        kinds = th.kinds;
        props = n.props !== false;
        cumWeight = new Float32Array(kinds.length);
        let sum = 0;
        for (let i = 0; i < kinds.length; i++) cumWeight[i] = sum += kinds[i].weight;
        burstPop = kinds.findIndex(k => k.shape === "confetti");
        burstPile = kinds.findIndex(k => k.lands);
        piling = n.piles && !!th.pile && burstPile >= 0;
        if (!piling) heights.fill(0);
        buildSprites();
        const total = Math.max(0, Math.min(MAX - 40, Math.round(n.density) || 0));
        const key = [n.theme, n.custom.shape, n.custom.direction, n.size].join("|");
        // a new look starts over; only a higher count adds particles to the ones already moving
        const from = key === particleKey ? Math.min(count, total) : 0;
        particleKey = key;
        if (W) for (let i = from; i < total; i++) spawn(i, true);
        count = live = W ? total : 0;
        buildLayer();
    }

    port.onmessage = e => {
        const m = e.data;
        switch (m.t) {
            case "init":
                cv = m.canvas;
                g = cv!.getContext("2d") as Ctx | null;
                break;
            case "size":
                if (!cv) break;
                W = m.w; H = m.h;
                cv.width = Math.ceil(W * m.dpr);
                cv.height = Math.ceil(H * m.dpr);
                if (m.dpr !== dpr) { dpr = m.dpr; spriteKey = ""; buildSprites(); }
                if (o && !count) setOpts(o);
                else buildLayer();
                break;
            case "opts":
                setOpts(m.o);
                break;
            case "image":
                image?.close();
                image = m.bmp;
                spriteKey = "";
                buildSprites();
                if (o) { for (let i = 0; i < count; i++) spr[i] = kindSprite[kd[i]] + Math.floor(Math.random() * kindSprites[kd[i]]); }
                break;
            case "rects":
                setRects(m.main, m.small, m.chat, m.zones);
                break;
            case "mouse":
                mx = m.x; my = m.y; mouseIn = m.on;
                if (pmx < -9000) { pmx = mx; pmy = my; }
                break;
            case "run":
                setRunning(m.on);
                break;
            case "stop":
                setRunning(false);
                image?.close();
                image = null;
                break;
        }
    };
    port.postMessage({ t: "ready" });
}

/* ================= Discord's side ================= */

const MAIN = ".guilds__5e434, .sidebarList__5e434, .page__5e434, .chatContent_f75fb0, .panels__5e434, .container_c8ffbb";
// snow also settles on things on the panels: server icons, the header, the chat box, the search bar
const SMALL = '[data-list-item-id^="guildsnav___"], [class*="subtitleContainer_"], [class*="channelTextArea_"], [class*="searchBar_"]';
const CHAT = ".chatContent_f75fb0";
const DATA_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

let canvas: HTMLCanvasElement | null = null;
let worker: Worker | null = null;
let send: ((m: any, transfer?: Transferable[]) => void) | null = null;
let opts: DecorationOptions | null = null;
let timer = 0, resizeTimer = 0, moveTimer = 0;
let mx = 0, my = 0, mouseIn = false;
let running: boolean | null = null;
let rectKey = "";
let imageSent: string | null | undefined;
let unsubStream: (() => void) | null = null;

function rectsOf(sel: string, max: number) {
    const out: number[] = [];
    const els = document.querySelectorAll(tc(sel));
    for (let i = 0; i < els.length && out.length < max * 4; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.width < 28 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) continue;
        out.push(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height));
    }
    return out;
}

// a card set pieces belong to: [x, y, w, h, corner radius], or zeros when it isn't on screen
function zone(sel: string) {
    const e = document.querySelector(sel);
    const r = e?.getBoundingClientRect();
    if (!e || !r || r.width < 80 || r.height < 30 || r.bottom < 0 || r.top > innerHeight) return [0, 0, 0, 0, 0];
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0];
}

function measure() {
    if (!send || !running) return;
    const main = rectsOf(MAIN, 12), small = rectsOf(SMALL, 36);
    let chatZone = zone(tc(CHAT));
    if (!chatZone[2]) chatZone = zone('[class*="peopleColumn_"], [class*="tabBody_"]');
    const zones = [...zone(tc(".sidebarList__5e434")), ...zone(`section${tc(".panels__5e434")}`), ...chatZone, ...zone('[class*="channelTextArea_"]')];
    const c = document.querySelector(tc(CHAT))?.getBoundingClientRect();
    const chat = c ? [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)] : null;
    const key = `${main}|${small}|${chat}|${zones}`;
    if (key === rectKey) return;
    rectKey = key;
    send({ t: "rects", main: new Float32Array(main), small: new Float32Array(small), chat: chat && new Float32Array(chat), zones: new Float32Array(zones) });
}

function postSize() {
    // in a worker the canvas costs Discord nothing, so it gets more pixels; drawn here, half resolution
    const d = Math.min(devicePixelRatio || 1, worker ? 1.25 : 1.5) * (worker ? 1 : 0.5);
    send?.({ t: "size", w: innerWidth, h: innerHeight, dpr: d });
}

function postOpts() {
    if (!send || !opts) return;
    send({ t: "opts", o: { ...opts, custom: { ...opts.custom, image: null } } });
    const c = opts.custom;
    const src = opts.theme === "custom" && (c.shape === "drawn" || c.shape === "image") && c.image && DATA_RE.test(c.image) ? c.image : null;
    if (src === imageSent) return;
    imageSent = src;
    if (!src) return send({ t: "image", bmp: null });
    const img = new Image();
    img.onload = () => {
        if (imageSent !== src) return;
        createImageBitmap(img).then(bmp => {
            if (imageSent === src && send) send({ t: "image", bmp }, [bmp]);
            else bmp.close();
        }, () => { });
    };
    img.src = src;
}

function pushAll() {
    postSize();
    postOpts();
    rectKey = "";
    running = null;
    sync();
}

function newCanvas() {
    canvas?.remove();
    canvas = document.createElement("canvas");
    canvas.className = "dz-deco";
    canvas.setAttribute("aria-hidden", "true");
    place();
    return canvas;
}

// no worker (or it failed to start): the same engine on this thread, drawing into a fresh canvas
function fallback() {
    worker?.terminate();
    worker = null;
    const c = newCanvas();
    const port: Port = { onmessage: null, postMessage() { } };
    decoEngine(port);
    send = m => port.onmessage?.({ data: m });
    send({ t: "init", canvas: c });
    imageSent = undefined;
    pushAll();
}

function create() {
    const c = newCanvas();
    try {
        if (typeof c.transferControlToOffscreen !== "function" || typeof Worker !== "function") return fallback();
        const url = URL.createObjectURL(new Blob([`(${decoEngine.toString()})(self)`], { type: "text/javascript" }));
        const w = new Worker(url);
        const off = c.transferControlToOffscreen();
        w.onmessage = e => { if (e.data?.t === "ready") URL.revokeObjectURL(url); };
        w.onerror = () => { URL.revokeObjectURL(url); if (worker === w) fallback(); };
        worker = w;
        send = (m, transfer) => w.postMessage(m, transfer ?? []);
        send({ t: "init", canvas: off }, [off]);
        pushAll();
    } catch {
        fallback();
    }
}

function shouldRun() {
    if (!canvas || document.hidden || inStreamMode()) return false;
    return !opts!.strictPause || document.hasFocus();
}

function sync() {
    if (!canvas || !send) return;
    canvas.style.visibility = inStreamMode() ? "hidden" : "";
    const run = shouldRun();
    if (run === running) return;
    running = run;
    send({ t: "run", on: run });
    if (run) measure();
}

function place() {
    if (canvas && !canvas.isConnected) (document.getElementById("app-mount") ?? document.body).append(canvas);
}

const flushMouse = () => { moveTimer = 0; send?.({ t: "mouse", x: mx, y: my, on: mouseIn }); };
// at most ~30 positions a second reach the engine, always the latest one
const onMove = (e: PointerEvent) => {
    mx = e.clientX; my = e.clientY; mouseIn = true;
    if (!moveTimer && running && opts?.mouse) moveTimer = window.setTimeout(flushMouse, 33);
};
const onLeave = () => { mouseIn = false; flushMouse(); };
const onResize = () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => { postSize(); rectKey = ""; measure(); }, 200); };

/* ---------- public ---------- */

export function startDecorations(o: DecorationOptions) {
    if (!o.theme || o.theme === "none") return stopDecorations();
    opts = o;
    if (!canvas) {
        window.addEventListener("resize", onResize);
        window.addEventListener("pointermove", onMove, { passive: true });
        document.documentElement.addEventListener("mouseleave", onLeave);
        window.addEventListener("focus", sync);
        window.addEventListener("blur", sync);
        document.addEventListener("visibilitychange", sync);
        unsubStream = onStreamMode(sync);
        timer = window.setInterval(() => { place(); measure(); sync(); }, 1000);
        create();
        return;
    }
    postOpts();
    sync();
}

export function stopDecorations() {
    send?.({ t: "stop" });
    worker?.terminate();
    worker = null;
    send = null;
    clearInterval(timer);
    clearTimeout(resizeTimer);
    clearTimeout(moveTimer);
    moveTimer = 0;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("mouseleave", onLeave);
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
    document.removeEventListener("visibilitychange", sync);
    unsubStream?.();
    unsubStream = null;
    canvas?.remove();
    canvas = null;
    opts = null;
    running = null;
    rectKey = "";
    imageSent = undefined;
}

/** An uploaded picture as a PNG data URL at most 64 px on its longest side (a few KB, well under 200 KB). */
export async function imageToDecoration(file: File): Promise<string> {
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) throw new Error("Use an image of 20 MB or less.");
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 64 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c.toDataURL("image/png");
}

/** Draw your own particle with the mouse on a 64x64 canvas; saved as a PNG data URL after every stroke. */
export function ShapeDrawer({ value, onChange }: { value: string | null; onChange(dataUrl: string): void; }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const prev = useRef<[number, number] | null>(null);
    const [empty, setEmpty] = useState(!value);

    useEffect(() => {
        const c = ref.current;
        if (!c || prev.current) return;
        const g = c.getContext("2d")!;
        g.clearRect(0, 0, 64, 64);
        if (!value || !DATA_RE.test(value)) return;
        const img = new Image();
        img.onload = () => g.drawImage(img, 0, 0, 64, 64);
        img.src = value;
    }, [value]);

    const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
        const r = e.currentTarget.getBoundingClientRect();
        return [(e.clientX - r.left) * 64 / r.width, (e.clientY - r.top) * 64 / r.height];
    };
    const line = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const g = e.currentTarget.getContext("2d")!, p = at(e), q = prev.current ?? p;
        g.strokeStyle = "#fff";
        g.lineWidth = 4;
        g.lineCap = g.lineJoin = "round";
        g.beginPath();
        g.moveTo(q[0], q[1]);
        g.lineTo(p[0] + 0.01, p[1]);
        g.stroke();
        prev.current = p;
    };
    const end = () => {
        if (!prev.current) return;
        prev.current = null;
        setEmpty(false);
        onChange(ref.current!.toDataURL("image/png"));
    };
    const clear = () => {
        ref.current!.getContext("2d")!.clearRect(0, 0, 64, 64);
        setEmpty(true);
        onChange("");
    };

    return React.createElement("div", { className: "dz-deco-draw" },
        React.createElement("canvas", {
            ref, width: 64, height: 64, "aria-label": "Draw your particle",
            onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); prev.current = null; line(e); },
            onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => { if (prev.current) line(e); },
            onPointerUp: end,
            onPointerCancel: end,
        }),
        React.createElement("button", { className: "dz-file-btn", onClick: clear, disabled: empty }, "Clear"),
    );
}

export const DECORATIONS_CSS = `
.dz-deco { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 999; pointer-events: none; contain: strict; }
.dz-deco-draw { display: flex; align-items: flex-end; gap: 10px; }
.dz-deco-draw canvas { width: 128px; height: 128px; image-rendering: pixelated; touch-action: none; cursor: crosshair; border-radius: 8px; background: repeating-conic-gradient(#ffffff10 0 25%, transparent 0 50%) 0 0 / 16px 16px, var(--background-secondary, #2b2d31); }
`;
