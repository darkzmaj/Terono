/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TERONO_LOGO } from "./assets";
import { isTeronoUser } from "./usage";

/* ================= the Terono mark =================
   A round Terono logo next to the buttons in the top right of a profile card (popout and full profile), on everyone who
   uses Terono. It looks like Discord's own round buttons there and does nothing: it only shows that this person uses
   Terono. Only people with Terono see it. */

const DONE = "dzMark";

// whose card a button row belongs to, read from the React tree that drew it
function userIdOf(el: Element): string | null {
    const key = Object.keys(el).find(k => k.startsWith("__reactFiber"));
    let f = key ? (el as any)[key] : null;
    for (let i = 0; f && i < 60; i++, f = f.return) {
        const p = f.memoizedProps;
        const id = p?.user?.id ?? p?.userId ?? p?.displayProfile?.userId;
        if (typeof id === "string" && /^\d{17,20}$/.test(id)) return id;
    }
    return null;
}

function decorate(button: HTMLElement) {
    // the row of round buttons: the nearest positioned flex box around the button
    let row: HTMLElement | null = button.parentElement;
    for (let i = 0; row && i < 6; i++, row = row.parentElement) {
        const cs = getComputedStyle(row);
        if (cs.position === "absolute" && cs.display === "flex") break;
    }
    if (!row || row.dataset[DONE]) return;
    row.dataset[DONE] = "1";
    const id = userIdOf(row);
    if (!id) return;
    void isTeronoUser(id).then(yes => {
        if (!yes || !row!.isConnected || row!.querySelector(".dz-mark")) return;
        const mark = document.createElement("div");
        mark.className = `${button.className} dz-mark`;
        mark.setAttribute("role", "img");
        mark.setAttribute("aria-label", "Uses Terono");
        mark.title = "Uses Terono";
        mark.append(Object.assign(document.createElement("img"), { src: TERONO_LOGO, alt: "" }));
        row!.prepend(mark);
    });
}

let observer: MutationObserver | null = null;
let frame = 0;

function scan() {
    frame = 0;
    for (const b of document.querySelectorAll<HTMLElement>('[class*="bannerButton_"]:not(.dz-mark)')) decorate(b);
}

export function startMark() {
    observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    // profile popouts and the full profile open in Discord's layer containers
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
}

export function stopMark() {
    observer?.disconnect();
    observer = null;
    cancelAnimationFrame(frame);
    frame = 0;
    document.querySelectorAll(".dz-mark").forEach(e => e.remove());
    document.querySelectorAll<HTMLElement>("[data-dz-mark]").forEach(e => delete e.dataset[DONE]);
}

export const MARK_CSS = `
.dz-mark { cursor: default !important; }
.dz-mark img { width: 18px; height: 18px; object-fit: contain; filter: drop-shadow(0 0 3px rgb(255 255 255 / 25%)); }
`;
