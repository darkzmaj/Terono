/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { tc } from "./classes";

/* ================= exact centering of the header's middle zone =================
   Items are ordered left(1) | spacer(2) | middle(3) | spacer(4) | right(5). Two equal flexible spacers
   only center the middle when both sides are equally wide, so the wider side's width difference is
   handed to the opposite spacer as its flex-basis.
   Discord re-renders the header several times while a channel loads (more on big servers), and every write
   to the spacers triggers another layout, so: at most one measurement per frame, nothing written when the
   result didn't change, and nothing to balance when no item sits in the middle. */

const HEADER = ".chat_f75fb0 > .subtitleContainer_f75fb0 .upperContainer__9293f";

let current: HTMLElement | null = null;
let resizeObs: ResizeObserver | null = null;
let childObs: MutationObserver | null = null;
let frame = 0;
let lastA = -1;
let lastB = -1;

function schedule() {
    if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        balance();
    });
}

function flexItems(container: HTMLElement) {
    const out: Element[] = [];
    for (const child of container.children) {
        if (child.classList.contains(tc("toolbar__9293f"))) out.push(...child.children);
        else out.push(child);
    }
    return out;
}

function balance() {
    if (!current?.isConnected) return;

    // read everything first, write once at the end (no layout thrashing)
    const gap = parseFloat(getComputedStyle(current).columnGap) || 0;
    let left = 0, right = 0, middle = false;
    for (const el of flexItems(current)) {
        const cs = getComputedStyle(el);
        if (cs.display === "none") continue;
        const order = Number(cs.order);
        if (order === 3) {
            middle = true;
            continue;
        }
        const w = el.getBoundingClientRect().width + gap;
        if (order < 3) left += w;
        else right += w;
    }

    const a = middle ? Math.round(Math.max(0, right - left)) : 0;
    const b = middle ? Math.round(Math.max(0, left - right)) : 0;
    if (Math.abs(a - lastA) <= 1 && Math.abs(b - lastB) <= 1) return;
    lastA = a;
    lastB = b;
    current.style.setProperty("--dz-bal-a", `${a}px`);
    current.style.setProperty("--dz-bal-b", `${b}px`);
}

function observeItems() {
    if (!current || !resizeObs) return;
    resizeObs.disconnect();
    resizeObs.observe(current);
    for (const el of flexItems(current)) resizeObs.observe(el);
}

export function attachHeader() {
    const el = document.querySelector<HTMLElement>(HEADER);
    if (el === current) return schedule();

    detachHeader();
    if (!el) return;

    current = el;
    resizeObs = new ResizeObserver(schedule);
    childObs = new MutationObserver(() => { observeItems(); schedule(); });
    childObs.observe(el, { childList: true });
    const toolbar = el.querySelector(tc(".toolbar__9293f"));
    if (toolbar) childObs.observe(toolbar, { childList: true });
    observeItems();
    balance();
}

export function detachHeader() {
    resizeObs?.disconnect();
    childObs?.disconnect();
    resizeObs = childObs = null;
    current = null;
    cancelAnimationFrame(frame);
    frame = 0;
    lastA = lastB = -1;
}

/* ================= header popouts open under their button =================
   Discord right-aligns them to the button. When the button lives in the left or middle zone,
   the new layer is re-anchored (and kept there if Discord re-positions it). */

function place(layer: HTMLElement, anchor: DOMRect, zone: number) {
    const fix = () => {
        if (!layer.isConnected) return obs.disconnect();
        const w = layer.getBoundingClientRect().width;
        const wanted = anchor.left + anchor.width / 2 - w / 2;
        const left = `${Math.round(Math.max(8, Math.min(wanted, innerWidth - w - 8)))}px`;
        if (layer.style.left !== left || layer.style.right !== "auto") {
            layer.style.left = left;
            layer.style.right = "auto";
        }
    };
    const obs = new MutationObserver(fix);
    obs.observe(layer, { attributes: true, attributeFilter: ["style"] });
    requestAnimationFrame(fix);
}

export function onHeaderClick(e: MouseEvent) {
    const btn = (e.target as Element | null)?.closest?.(".title_f75fb0 .toolbar__9293f > *");
    if (!btn) return;

    const zone = Number(getComputedStyle(btn).order);
    if (!(zone < 5)) return;

    const anchor = btn.getBoundingClientRect();
    const watch = new MutationObserver(records => {
        for (const r of records) for (const node of r.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const layer = node.matches(tc(".layer__59d0d")) ? node : node.querySelector<HTMLElement>(tc(".layer__59d0d"));
            if (layer) place(layer, anchor, zone);
        }
    });
    for (const c of document.querySelectorAll(tc(".layerContainer__59d0d"))) watch.observe(c, { childList: true, subtree: true });
    setTimeout(() => watch.disconnect(), 800);
}
