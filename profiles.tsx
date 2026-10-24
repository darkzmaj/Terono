/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { copyToClipboard } from "@utils/clipboard";
import { OptionType } from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import { Alerts, useEffect, useState } from "@webpack/common";

import { BADGE_API, badgesReady } from "./badgeConfig";
import { applyAll, getUploadedLogo, HEX_RE, LOGO_DATA_RE, refreshSettingsUi, settings, setUploadedLogo, URL_RE } from "./settings";
import { toast } from "./toast";

/* ================= profiles =================
   Saved setups: all of Terono or only some parts (just the colors, just the layout, …), applied in one click,
   exported as files, or shared as a code: 30 characters shown with "//" between them (a//$//K//…). Pasting a code
   anywhere in Terono loads that profile. Codes are kept on the Terono server; imported data is always checked. */

const PROFILES_KEY = "Terono_profiles";
const FORMAT = "terono-profile";
const OLD_FORMAT = "darkness-profile";
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_SHARED_LOGO = 90 * 1024;

export const GROUPS: Record<string, { label: string; keys: string[]; }> = {
    colors: { label: "Colors", keys: ["accentPreset", "accent", "customText", "textColor", "customIcons", "iconColor", "voice", "close", "minimize", "maximize", "appBorder", "borderColor", "borderColor2", "appBorderWidth"] },
    cards: { label: "Panels", keys: ["cardPreset", "cardFill", "cardColor", "cardColor2", "cardAngle", "panels", "cardShape", "cardStyle", "glassOpacity", "glassBlur", "liquidColor", "liquidSpeed", "cardMedia", "cardMediaUrl", "cardMediaDim"] },
    embeds: { label: "Embeds", keys: ["embedStyle", "embedColor", "embedColor2", "embedAngle", "embedOpacity"] },
    background: { label: "Background", keys: ["background", "bgBase", "bgColor1", "bgColor2", "bgMediaSource", "bgMediaUrl", "bgMediaDim"] },
    fonts: { label: "Font", keys: ["font"] },
    logo: { label: "Logo & icons", keys: ["logoSource", "logoUrl", "logoSize", "quickIcon", "loadingScreen", "avatarShape"] },
    layout: { label: "Layout", keys: ["serverList", "serverListDirection", "channelsSide", "membersSide"] },
    header: { label: "Channel header", keys: ["headerName", "headerHash", "headerFollow", "headerButtons", "headerSearch", "dmHeaderName", "dmHeaderButtons", "dmHeaderSearch", "headerHiddenButtons"] },
    chat: { label: "Chat & members", keys: ["chatSides", "chatTranslate", "chatGif", "chatEmoji", "chatSticker", "chatGift", "chatApps", "chatOtherVencord", "showActivities", "roleCount", "roleCountCustom"] },
    calls: { label: "Calls", keys: ["callAmbient"] },
    overlay: { label: "Overlay", keys: ["overlayShow", "overlayKey", "overlayCorner", "overlayCompact", "overlayToasts", "overlayOpacity"] },
    tools: { label: "Tools & shortcuts", keys: ["bulkMode", "homeDoubleClick", "openKeybind", "searchTools", "blockedButton"] },
    menus: { label: "Menus", keys: ["hiddenMenuItems", "hiddenServerMenu", "hiddenUserMenu"] },
    translate: { label: "Translate", keys: ["autoTranslate", "keepLanguages"] },
};

// ready-made choices for "what goes into this profile"
const KINDS: Record<string, { label: string; groups: string[]; }> = {
    all: { label: "Everything", groups: Object.keys(GROUPS) },
    look: { label: "Look only (colors, panels, background, font)", groups: ["colors", "cards", "embeds", "background", "fonts", "logo"] },
    layout: { label: "Layout only (sides, header, chat)", groups: ["layout", "header", "chat"] },
    features: { label: "Features only (calls, overlay, tools)", groups: ["calls", "overlay", "tools", "menus", "translate"] },
    custom: { label: "Pick sections…", groups: [] },
};

const ALL_KEYS = new Set(Object.values(GROUPS).flatMap(g => g.keys));

export interface Profile {
    name: string;
    groups: string[];
    settings: Record<string, unknown>;
    logo?: string;
}

/* ================= validation (imported and shared profiles are untrusted) ================= */

function isValidValue(key: string, value: unknown) {
    const def = (settings.def as Record<string, any>)[key];
    if (!def) return false;

    switch (def.type) {
        case OptionType.SELECT: return def.options.some((o: { value: unknown; }) => o.value === value);
        case OptionType.BOOLEAN: return typeof value === "boolean";
        case OptionType.SLIDER: return typeof value === "number" && value >= def.markers[0] && value <= def.markers.at(-1);
        case OptionType.COMPONENT: return typeof value === "string" && HEX_RE.test(value);
        case OptionType.STRING:
            if (typeof value !== "string" || value.length > 1000) return false;
            return !/^(logoUrl|bgMediaUrl|cardMediaUrl)$/.test(key) || value === "" || URL_RE.test(value);
        default: return false;
    }
}

function sanitize(raw: any): Profile | null {
    if (!raw || typeof raw !== "object" || typeof raw.name !== "string" || typeof raw.settings !== "object" || !raw.settings) return null;

    const name = raw.name.trim().slice(0, 60);
    if (!name) return null;

    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw.settings)) {
        if (ALL_KEYS.has(k) && isValidValue(k, v)) clean[k] = v;
    }

    const groups = Array.isArray(raw.groups) ? raw.groups.filter((g: unknown) => typeof g === "string" && g in GROUPS) : [];
    const logo = typeof raw.logo === "string" && raw.logo.length < 8_000_000 && LOGO_DATA_RE.test(raw.logo) ? raw.logo : undefined;

    return { name, groups, settings: clean, logo };
}

/* ================= actions ================= */

function snapshot(name: string, groups: string[]): Profile {
    const store = settings.store as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const g of groups) for (const k of GROUPS[g].keys) if (k in settings.def) data[k] = store[k];

    const logo = groups.includes("logo") && store.logoSource === "file" ? getUploadedLogo() ?? undefined : undefined;
    return { name, groups, settings: data, logo };
}

async function applyProfile(p: Profile) {
    const store = settings.store as Record<string, unknown>;
    for (const [k, v] of Object.entries(p.settings)) {
        if (isValidValue(k, v)) store[k] = v;
    }
    // saved before 1.0.4, when custom card colors always used the text color
    if (p.settings.cardPreset === "custom" && isValidValue("textColor", p.settings.textColor) && !("customText" in p.settings)) store.customText = true;
    if (p.logo) await setUploadedLogo(p.logo);
    applyAll();
    refreshSettingsUi();
    toast(`Applied “${p.name}”.`, "success");
}

function exportProfile(p: Profile) {
    const safe = p.name.replace(/[^\w-]+/g, "_").slice(0, 40) || "profile";
    const json = JSON.stringify({ format: FORMAT, version: 1, ...p }, null, 2);
    saveFile(new File([json], `${safe}.terono.json`, { type: "application/json" }));
}

/* ---------- share codes ---------- */

export const showCode = (code: string) => code.split("").join("//");
const looksLikeCode = (s: string) => s.replace(/\/\/|\s/g, "").length === 30;

async function shareProfile(p: Profile) {
    // the server keeps shared profiles small: a big uploaded logo stays out
    const body = { ...p, logo: p.logo && p.logo.length <= MAX_SHARED_LOGO ? p.logo : undefined };
    const res = await fetch(`${BADGE_API}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: { format: FORMAT, version: 1, ...body } }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.code) throw new Error(data.error ?? `Error ${res.status}`);
    return { code: data.code as string, droppedLogo: !!p.logo && !body.logo };
}

export async function loadCode(text: string) {
    const res = await fetch(`${BADGE_API}/share/get`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: text.trim() }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
    const p = sanitize(data.profile);
    if (!p || !Object.keys(p.settings).length) throw new Error("That code has no Terono profile");
    return p;
}

function defaultOf(def: any) {
    if (def.type === OptionType.SELECT) return (def.options.find((o: any) => o.default) ?? def.options[0]).value;
    return def.default;
}

function resetAll() {
    Alerts.show({
        title: "Reset Terono?",
        body: "All Terono settings go back to default and the uploaded logo is removed. Saved profiles are kept.",
        confirmText: "Reset",
        cancelText: "Cancel",
        async onConfirm() {
            const store = settings.store as Record<string, unknown>;
            for (const [k, def] of Object.entries(settings.def as Record<string, any>)) {
                if (k === "peopleLooks") continue;
                const v = defaultOf(def);
                if (v !== undefined) store[k] = v;
            }
            await setUploadedLogo(null);
            applyAll();
            refreshSettingsUi();
            toast("Terono reset to defaults.", "success");
        },
    });
}

/* ================= UI ================= */

const groupsLabel = (p: Profile) => p.groups.length === Object.keys(GROUPS).length ? "Everything" : p.groups.map(g => GROUPS[g]?.label).filter(Boolean).join(", ") || "Custom";

export function ProfilesPanel() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [name, setName] = useState("");
    const [kind, setKind] = useState("all");
    const [groups, setGroups] = useState<string[]>(Object.keys(GROUPS));
    const [filter, setFilter] = useState("");
    const [code, setCode] = useState("");
    const [shared, setShared] = useState<Record<string, string>>({});

    useEffect(() => {
        DataStore.get<unknown[]>(PROFILES_KEY).then(list =>
            setProfiles((Array.isArray(list) ? list : []).map(sanitize).filter(Boolean) as Profile[]));
    }, []);

    async function persist(next: Profile[]) {
        setProfiles(next);
        await DataStore.set(PROFILES_KEY, next);
    }

    const upsert = (p: Profile) => persist([...profiles.filter(x => x.name !== p.name), p]);

    function pickKind(k: string) {
        setKind(k);
        if (k !== "custom") setGroups(KINDS[k].groups);
    }

    async function save() {
        const n = name.trim().slice(0, 60);
        if (!n) return toast("Give the profile a name.", "failure");
        if (!groups.length) return toast("Pick at least one section to save.", "failure");
        await upsert(snapshot(n, groups));
        setName("");
        toast(`Saved “${n}”.`, "success");
    }

    async function importFile() {
        const file = await chooseFile("application/json,.json");
        if (!file) return;
        if (file.size > MAX_IMPORT_BYTES) return toast("File is too large.", "failure");
        let parsed: any;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            return toast("That file isn't valid JSON.", "failure");
        }
        const p = parsed?.format === FORMAT || parsed?.format === OLD_FORMAT ? sanitize(parsed) : null;
        if (!p || !Object.keys(p.settings).length) return toast("Not a Terono profile.", "failure");
        await upsert(p);
        toast(`Imported “${p.name}”. Press Apply to use it.`, "success");
    }

    async function share(p: Profile) {
        try {
            const { code: c, droppedLogo } = await shareProfile(p);
            setShared(s => ({ ...s, [p.name]: c }));
            await copyToClipboard(showCode(c));
            toast(`Code copied${droppedLogo ? " (the uploaded logo is too big to share)" : ""}. Anyone can paste it in Terono → Profiles.`, "success");
        } catch (e) {
            toast(`Couldn't share: ${e instanceof Error ? e.message : e}`, "failure");
        }
    }

    async function load(apply: boolean) {
        try {
            const p = await loadCode(code);
            await upsert(p);
            setCode("");
            if (apply) await applyProfile(p);
            else toast(`Added “${p.name}”. Press Apply to use it.`, "success");
        } catch (e) {
            toast(`Couldn't load: ${e instanceof Error ? e.message : e}`, "failure");
        }
    }

    const shown = profiles.filter(p => !filter || (filter in GROUPS ? p.groups.includes(filter) : true));

    return (
        <div className="dz-profiles">
            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Load a shared profile</h3>
                <div className="dz-prof-row">
                    <input className="dz-input dz-grow" placeholder="Paste a code, like a//$//K//…" value={code} onChange={e => setCode(e.currentTarget.value)} />
                    <Button size="small" disabled={!badgesReady() || !looksLikeCode(code)} onClick={() => load(true)}>Load & apply</Button>
                    <Button size="small" variant="secondary" disabled={!badgesReady() || !looksLikeCode(code)} onClick={() => load(false)}>Only add</Button>
                </div>
            </section>

            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Save what you have now</h3>
                <div className="dz-prof-row">
                    <input className="dz-input dz-grow" value={name} onChange={e => setName(e.currentTarget.value)} placeholder="Profile name, e.g. Night blue" maxLength={60} />
                    <select className="dz-input" value={kind} onChange={e => pickKind(e.currentTarget.value)} aria-label="What to include">
                        {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <Button size="small" onClick={save}>Save</Button>
                </div>
                {kind === "custom" && (
                    <div className="dz-prof-chips">
                        {Object.entries(GROUPS).map(([id, g]) => (
                            <button key={id} className={`dz-chip ${groups.includes(id) ? "dz-on" : ""}`} aria-pressed={groups.includes(id)}
                                onClick={() => setGroups(groups.includes(id) ? groups.filter(x => x !== id) : [...groups, id])}>{g.label}</button>
                        ))}
                    </div>
                )}
            </section>

            <section className="dz-set-group">
                <div className="dz-prof-head">
                    <h3 className="dz-set-group-title">Your profiles</h3>
                    {profiles.length > 1 && (
                        <select className="dz-input" value={filter} onChange={e => setFilter(e.currentTarget.value)} aria-label="Show profiles with">
                            <option value="">All profiles</option>
                            {Object.entries(GROUPS).map(([id, g]) => <option key={id} value={id}>With {g.label.toLowerCase()}</option>)}
                        </select>
                    )}
                </div>
                {shown.length === 0 && <p className="dz-look-note">{profiles.length ? "None with that." : "None yet: save one above or load a code."}</p>}
                {shown.map(p => (
                    <div key={p.name} className="dz-prof">
                        <div className="dz-prof-text">
                            <b>{p.name}</b>
                            <span>{groupsLabel(p)}</span>
                            {shared[p.name] && <code className="dz-prof-code" title="Click to copy" onClick={() => { copyToClipboard(showCode(shared[p.name])); toast("Copied.", "success"); }}>{showCode(shared[p.name])}</code>}
                        </div>
                        <Button size="small" onClick={() => applyProfile(p)}>Apply</Button>
                        <Button size="small" variant="secondary" disabled={!badgesReady()} onClick={() => share(p)}>Share</Button>
                        <Button size="small" variant="secondary" onClick={() => exportProfile(p)}>Export</Button>
                        <Button size="small" variant="dangerSecondary" onClick={() => persist(profiles.filter(x => x !== p))}>Delete</Button>
                    </div>
                ))}
            </section>

            <div className="dz-prof-row">
                <Button size="small" variant="secondary" onClick={importFile}>Import file</Button>
                <Button size="small" variant="secondary" onClick={() => exportProfile(snapshot("Current", Object.keys(GROUPS)))}>Export everything</Button>
                <span className="dz-grow" />
                <Button size="small" variant="dangerPrimary" onClick={resetAll}>Reset Terono to defaults</Button>
            </div>
        </div>
    );
}

export const PROFILES_CSS = `
.dz-profiles { display: flex; flex-direction: column; gap: 14px; }
.dz-prof-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 0 10px; }
.dz-grow { flex: 1; min-width: 160px; }
.dz-prof-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 0 10px; }
.dz-chip { padding: 5px 11px; border-radius: 999px; cursor: pointer; font: 600 12px var(--font-primary, "gg sans", sans-serif); color: var(--text-muted, #aaa);
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-chip.dz-on { color: #fff; border-color: transparent; background: var(--dz-accent, #429cff); }
.dz-prof-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dz-prof { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 0; border-top: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-prof:first-of-type { border-top: none; }
.dz-prof-text { flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 2px; color: var(--text-default, #fff); }
.dz-prof-text span { font-size: 12px; color: var(--text-muted, #aaa); }
.dz-prof-code { margin-top: 4px; padding: 4px 8px; border-radius: 6px; cursor: copy; font-size: 11px; word-break: break-all; color: var(--dz-accent, #429cff);
    background: color-mix(in srgb, var(--dz-accent, #429cff) 10%, transparent); }
`;
