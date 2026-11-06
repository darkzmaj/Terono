/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { wreq } from "@webpack";

import { CLASS_SIGNATURES } from "./classSignatures";

/* ================= Discord's class names, whatever build is running =================
   Terono's theme and code name Discord's style classes as they were written (guilds__5e434, chat_f75fb0, …).
   Discord's November 2026 build renamed every one (guilds_pog62O), and it rolls out to some people before
   others, so both kinds of name are in use at once, and it can happen again.

   Each name has a readable part (guilds) and a part that says which stylesheet it comes from (5e434). For every
   stylesheet Terono uses, classSignatures.ts lists all the readable names it had. At start, the stylesheets of the
   running Discord are read from its code (each is a module exporting its class names), every old stylesheet is
   matched to the current one with the most names in common, and each old name is mapped to the current one.
   On a build that still has the old names nothing changes. Stylesheets that Discord only loads later (settings,
   some popouts) are picked up when they appear. */

const OLD = /\b([A-Za-z][\w-]*?)(__[0-9a-f]{5}|_[0-9a-f]{6})\b/g;
const CURRENT = /^([A-Za-z][\w-]*?)_([\w-]{5,8})$/;

const map = new Map<string, string>();
const unresolved = new Set(Object.keys(CLASS_SIGNATURES));
let identity = false;
let version = 0;
const listeners = new Set<() => void>();

/** current class names: one map per stylesheet (by its class suffix), readable name -> class. The new build splits
    one stylesheet's classes over several small modules, which all share the stylesheet's suffix. */
function currentSheets() {
    const bySuffix = new Map<string, Map<string, string>>();
    for (const id in wreq.c) {
        const e = wreq.c[id]?.exports;
        if (!e || typeof e !== "object") continue;
        let values: unknown[];
        try { values = Object.values(e); } catch { continue; }
        if (!values.length || values.length > 600) continue;
        // a stylesheet module: only strings, nearly all of them class names (some values are empty or composed)
        const found: [string, string, string][] = [];
        let strings = 0, bad = 0;
        for (const v of values) {
            if (typeof v !== "string") { bad = values.length; break; }
            strings++;
            let any = false;
            for (const tok of v.split(" ")) {
                const m = CURRENT.exec(tok);
                if (m) { found.push([m[2], m[1], tok]); any = true; }
            }
            if (!any) bad++;
        }
        if (!found.length || bad > strings * 0.2) continue;
        for (const [suffix, name, tok] of found) {
            let sheet = bySuffix.get(suffix);
            if (!sheet) bySuffix.set(suffix, sheet = new Map());
            sheet.set(name, tok);
        }
    }
    return [...bySuffix.values()];
}

/** (Re)builds the old -> current map; returns true when it changed. */
export function rebuildClassMap() {
    if (identity || !unresolved.size) return false;
    const sheets = currentSheets();
    if (!sheets.length) return false;
    // still the old build: Discord's own classes include the old names
    const probe = "guilds__5e434";
    if (sheets.some(s => [...s.values()].includes(probe))) { identity = true; unresolved.clear(); return false; }

    // by name: every current class with the same readable name is a candidate; with several, the one whose stylesheet
    // shares the most names with the old stylesheet wins (the new build keeps only the classes its code uses, so
    // whole stylesheets can't be compared, but the names they still have can)
    const byName = new Map<string, Map<string, string>[]>();
    for (const sheet of sheets) for (const name of sheet.keys()) {
        let list = byName.get(name);
        if (!list) byName.set(name, list = []);
        list.push(sheet);
    }
    let changed = false;
    for (const suffix of [...unresolved]) {
        const names: string[] = CLASS_SIGNATURES[suffix];
        const sig = new Set(names);
        const sep = suffix.length === 5 ? "__" : "_";
        let all = true;
        for (const n of names) {
            const old = `${n}${sep}${suffix}`;
            if (map.has(old)) continue;
            const cands = byName.get(n);
            if (!cands?.length) { all = false; continue; }
            let best = cands[0], bestCommon = -1, bestPrec = 0;
            for (const c of cands) {
                let common = 0;
                for (const k of c.keys()) if (sig.has(k)) common++;
                const prec = common / c.size;
                if (common > bestCommon || (common === bestCommon && prec > bestPrec)) { best = c; bestCommon = common; bestPrec = prec; }
            }
            // one candidate is that name for sure; among several, the winner must share more than the name itself
            if (cands.length > 1 && bestCommon < 2 && names.length > 1) { all = false; continue; }
            map.set(old, best.get(n)!);
            changed = true;
        }
        // every name found: done with this stylesheet; otherwise look again when Discord loads more
        if (all) unresolved.delete(suffix);
    }
    if (changed) { version++; listeners.forEach(f => { try { f(); } catch { } }); }
    return changed;
}

/** Discord's current names for the old ones in a piece of CSS or a selector. */
export function tc(text: string): string {
    if (identity || !map.size) return text;
    return text.replace(OLD, t => map.get(t) ?? t);
}

/** Called whenever names were added, to re-apply what was written with the old ones. */
export function onClassMapChange(f: () => void) { listeners.add(f); return () => void listeners.delete(f); }
export const classMapVersion = () => version;

// stylesheets Discord loads later: look again for a while after start, then now and then
let timer = 0;
let tries = 0;
export function startClassMap() {
    try { rebuildClassMap(); } catch { /* Discord's module cache not readable: the names stay as written */ }
    const again = () => {
        try { rebuildClassMap(); } catch { }
        if (identity || !unresolved.size) return;
        timer = window.setTimeout(again, ++tries < 24 ? 5000 : 60000);
    };
    timer = window.setTimeout(again, 3000);
}

export function stopClassMap() { clearTimeout(timer); }

// for troubleshooting: how many of Terono's stylesheets were found in the running Discord
export const classMapStatus = () => ({ identity, mapped: map.size, missing: [...unresolved] });
