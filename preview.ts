/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { plugins } from "@api/PluginManager";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { filters, mapMangledModuleLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

import { applyPreset, Preset, PRESET_KEYS, PRESETS, writePresetValues } from "./presets";
import { refreshSettingsUi, settings } from "./settings";
import { toast } from "./toast";

// Preset preview: settings close, the preset is tried on the real app, and a bar at the bottom offers Keep or
// Go back (plus the layout switch and browsing to the next preset). What was set before is kept in the
// DataStore until then, so a restart in the middle of a preview still goes back to it.

const BACKUP_KEY = "Terono_presetPreview";

let backup: Record<string, unknown> | null = null;
let current: Preset | null = null;
let withLayout = false;
let bar: HTMLDivElement | null = null;

const store = () => settings.store as Record<string, unknown>;

// Discord's "close every modal" (the one Vencord maps picks up a different function in current Discord)
const Modals = mapMangledModuleLazy(".modalKey?", {
    closeAll: filters.byCode(/\.getState\(\);for\(let \i in \i\)/),
}) as { closeAll(): void; };

function closeModals() {
    try {
        Modals.closeAll();
    } catch {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    }
}

function restoreBackup() {
    if (!backup) return;
    const s = store();
    for (const [k, v] of Object.entries(backup)) s[k] = v;
}

function show() {
    if (!current) return;
    restoreBackup();
    writePresetValues(current, withLayout);
    renderBar();
}

export function startPreview(p: Preset, layout = false) {
    if (!backup) {
        const s = store();
        backup = Object.fromEntries([...PRESET_KEYS, "presetId"].map(k => [k, s[k]]));
        DataStore.set(BACKUP_KEY, backup);
    }
    current = p;
    withLayout = layout;
    show();

    // out of the way, so the preview is the actual app
    closeModals();
    FluxDispatcher.dispatch({ type: "LAYER_POP_ALL" });
}

function finish(keep: boolean) {
    if (!current) return;
    const p = current;
    if (keep) applyPreset(p, withLayout);
    else restoreBackup();
    backup = current = null;
    DataStore.del(BACKUP_KEY);
    removeBar();
    refreshSettingsUi();
    if (keep) toast(`${p.name} applied. Change anything you like in the settings.`, "success");
    openPluginModal(plugins.Terono);
}

function step(dir: 1 | -1) {
    if (!current) return;
    const i = PRESETS.indexOf(current);
    current = PRESETS[(i + dir + PRESETS.length) % PRESETS.length];
    show();
}

/* ---------- the bar (plain DOM: it lives outside every Discord layer and modal) ---------- */

function button(text: string, cls: string, onClick: () => void, label?: string) {
    const b = document.createElement("button");
    b.className = `dz-pv-btn ${cls}`;
    b.textContent = text;
    if (label) b.setAttribute("aria-label", label);
    b.onclick = onClick;
    return b;
}

function renderBar() {
    if (!current) return;
    if (!bar) {
        bar = document.createElement("div");
        bar.className = "dz-pv";
        bar.setAttribute("role", "dialog");
        bar.setAttribute("aria-label", "Preset preview");
        document.body.append(bar);
    }

    const title = document.createElement("div");
    title.className = "dz-pv-title";
    title.innerHTML = "<span>Previewing</span>";
    const name = document.createElement("b");
    name.textContent = current.name;
    title.append(name);

    const layout = document.createElement("label");
    layout.className = "dz-pv-layout";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = withLayout;
    box.onchange = () => { withLayout = box.checked; show(); };
    layout.append(box, " Include layout");

    bar.replaceChildren(
        button("‹", "dz-pv-nav", () => step(-1), "Previous preset"),
        title,
        button("›", "dz-pv-nav", () => step(1), "Next preset"),
        layout,
        button("Go back", "dz-pv-back", () => finish(false)),
        button("Keep", "dz-pv-keep", () => finish(true)),
    );
}

function removeBar() {
    bar?.remove();
    bar = null;
}

// start: a preview that was still open when Discord closed goes back to what was set before
export async function restoreUnfinishedPreview() {
    const saved = await DataStore.get<Record<string, unknown>>(BACKUP_KEY);
    if (!saved || typeof saved !== "object") return;
    const s = store();
    for (const [k, v] of Object.entries(saved)) if (k === "presetId" || PRESET_KEYS.includes(k)) s[k] = v;
    await DataStore.del(BACKUP_KEY);
}

// stop: leave the settings as they were before the preview
export function cancelPreview() {
    if (!current) return;
    restoreBackup();
    backup = current = null;
    DataStore.del(BACKUP_KEY);
    removeBar();
}

export const PREVIEW_CSS = `
.dz-pv { position: fixed; left: 50%; bottom: 22px; z-index: 10000; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 16px; color: var(--dz-text, #f1f2f4); font: 500 14px var(--font, "gg sans"), sans-serif;
    background: color-mix(in srgb, var(--dz-card, #070708) 92%, transparent); border: 1px solid color-mix(in srgb, var(--dz-accent, #429cff) 45%, transparent);
    box-shadow: 0 14px 40px rgb(0 0 0 / 45%), 0 0 0 1px rgb(0 0 0 / 30%); backdrop-filter: blur(12px); animation: dz-pv-in 220ms cubic-bezier(.2,.9,.3,1.2) both; }
.dz-pv-title { display: flex; flex-direction: column; min-width: 150px; padding: 0 6px; text-align: center; line-height: 1.2; }
.dz-pv-title span { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--dz-accent, #429cff); }
.dz-pv-title b { font-size: 15px; white-space: nowrap; }
.dz-pv-btn { height: 34px; padding: 0 14px; white-space: nowrap; border-radius: 10px; font: 600 14px var(--font, "gg sans"), sans-serif; cursor: pointer; color: var(--dz-text, #f1f2f4);
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); transition: background 120ms ease, transform 120ms ease; }
.dz-pv-btn:hover { background: color-mix(in srgb, var(--dz-text, #f1f2f4) 14%, transparent); }
.dz-pv-btn:active { transform: scale(.96); }
.dz-pv-nav { width: 34px; padding: 0; font-size: 20px; }
.dz-pv-keep { color: #fff; background: var(--dz-accent, #429cff); }
.dz-pv-keep:hover { background: color-mix(in srgb, var(--dz-accent, #429cff), #fff 12%); }
.dz-pv-layout { display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.dz-pv-layout input { accent-color: var(--dz-accent, #429cff); width: 15px; height: 15px; margin: 0; cursor: pointer; }
@keyframes dz-pv-in { from { opacity: 0; transform: translate(-50%, 16px); } }
@media (prefers-reduced-motion: reduce) { .dz-pv { animation: none; } }`;
