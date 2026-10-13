/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { HeadingTertiary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { OptionType } from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import { Alerts, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";

import { applyAll, getUploadedLogo, HEX_RE, LOGO_DATA_RE, refreshSettingsUi, settings, setUploadedLogo, URL_RE } from "./settings";

const PROFILES_KEY = "Terono_profiles";
const FORMAT = "terono-profile";
const OLD_FORMAT = "darkness-profile";
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const GROUPS: Record<string, { label: string; keys: string[]; }> = {
    colors: { label: "Colors", keys: ["accentPreset", "accent", "customText", "textColor", "customIcons", "iconColor", "voice", "close", "minimize", "maximize", "appBorder", "borderColor", "borderColor2", "appBorderWidth"] },
    cards: { label: "Cards", keys: ["cardPreset", "cardFill", "cardColor", "cardColor2", "cardAngle", "cardShape", "cardStyle", "glassOpacity", "glassBlur", "liquidColor", "liquidSpeed",
        "embedStyle", "embedColor", "embedColor2", "embedAngle", "embedOpacity", "cardMedia", "cardMediaUrl", "cardMediaDim"] },
    background: { label: "Background", keys: ["background", "bgBase", "bgColor1", "bgColor2", "bgMediaSource", "bgMediaUrl", "bgMediaDim"] },
    layout: { label: "Layout & logo", keys: ["serverList", "serverListDirection", "channelsSide", "membersSide", "roleCount", "roleCountCustom", "font", "logoSource", "logoUrl", "logoSize", "quickIcon", "loadingScreen", "lite", "pauseUnfocused", "bulkMode", "homeDoubleClick", "callAmbient", "overlayShow", "overlayKey", "overlayCorner", "overlayCompact", "overlayToasts", "overlayOpacity", "autoUpdate"] },
    header: { label: "Channel header", keys: ["headerName", "headerHash", "headerFollow", "headerButtons", "headerSearch", "dmHeaderName", "dmHeaderButtons", "dmHeaderSearch", "headerHiddenButtons"] },
    chat: { label: "Chat bar & activities", keys: ["chatTranslate", "chatGif", "chatEmoji", "chatSticker", "chatGift", "chatApps", "chatOtherVencord", "showActivities", "chatSides"] },
    menus: { label: "Menus", keys: ["hiddenMenuItems", "hiddenServerMenu", "hiddenUserMenu"] },
    translate: { label: "Translate", keys: ["autoTranslate", "keepLanguages"] },
};

const ALL_KEYS = new Set(Object.values(GROUPS).flatMap(g => g.keys));

interface Profile {
    name: string;
    groups: string[];
    settings: Record<string, unknown>;
    logo?: string;
}

/* ================= validation (imported JSON is untrusted) ================= */

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
    for (const g of groups) for (const k of GROUPS[g].keys) data[k] = store[k];

    const logo = groups.includes("layout") && store.logoSource === "file" ? getUploadedLogo() ?? undefined : undefined;
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
    showToast(`Applied “${p.name}”.`, Toasts.Type.SUCCESS);
}

function exportProfile(p: Profile) {
    const safe = p.name.replace(/[^\w-]+/g, "_").slice(0, 40) || "profile";
    const json = JSON.stringify({ format: FORMAT, version: 1, ...p }, null, 2);
    saveFile(new File([json], `${safe}.terono.json`, { type: "application/json" }));
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
                const v = defaultOf(def);
                if (v !== undefined) store[k] = v;
            }
            await setUploadedLogo(null);
            applyAll();
            refreshSettingsUi();
            showToast("Terono reset to defaults.", Toasts.Type.SUCCESS);
        },
    });
}

/* ================= UI ================= */

const row = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } as const;
const box = { padding: 12, borderRadius: 8, border: "1px solid var(--border-subtle)", marginBottom: 12 } as const;

export function ProfilesPanel() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [name, setName] = useState("");
    const [groups, setGroups] = useState<string[]>(Object.keys(GROUPS));

    useEffect(() => {
        DataStore.get<unknown[]>(PROFILES_KEY).then(list =>
            setProfiles((Array.isArray(list) ? list : []).map(sanitize).filter(Boolean) as Profile[]));
    }, []);

    async function persist(next: Profile[]) {
        setProfiles(next);
        await DataStore.set(PROFILES_KEY, next);
    }

    const upsert = (p: Profile) => persist([...profiles.filter(x => x.name !== p.name), p]);

    async function save() {
        const n = name.trim().slice(0, 60);
        if (!n) return showToast("Give the profile a name.", Toasts.Type.FAILURE);
        if (!groups.length) return showToast("Pick at least one section to save.", Toasts.Type.FAILURE);
        await upsert(snapshot(n, groups));
        setName("");
        showToast(`Saved “${n}”.`, Toasts.Type.SUCCESS);
    }

    async function importFile() {
        const file = await chooseFile("application/json,.json");
        if (!file) return;
        if (file.size > MAX_IMPORT_BYTES) return showToast("File is too large.", Toasts.Type.FAILURE);

        let parsed: any;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            return showToast("That file isn't valid JSON.", Toasts.Type.FAILURE);
        }

        const p = parsed?.format === FORMAT || parsed?.format === OLD_FORMAT ? sanitize(parsed) : null;
        if (!p || !Object.keys(p.settings).length) return showToast("Not a Terono profile.", Toasts.Type.FAILURE);

        await upsert(p);
        showToast(`Imported “${p.name}”. Press Apply to use it.`, Toasts.Type.SUCCESS);
    }

    return (
        <div>
            <HeadingTertiary>Profiles</HeadingTertiary>
            <Paragraph style={{ marginBottom: 8 }}>Save your setup (all of it or only some sections), switch between saved looks, back them up as files.</Paragraph>

            <div style={box}>
                <div style={row}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                        <TextInput value={name} onChange={setName} placeholder="Profile name, e.g. Sigma" maxLength={60} />
                    </div>
                    <Button size="small" onClick={save}>Save current</Button>
                </div>
                <div style={{ ...row, marginTop: 10 }}>
                    {Object.entries(GROUPS).map(([id, g]) => (
                        <label key={id} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-default)", cursor: "pointer" }}>
                            <input
                                type="checkbox"
                                checked={groups.includes(id)}
                                onChange={e => setGroups(e.currentTarget.checked ? [...groups, id] : groups.filter(x => x !== id))}
                            />
                            {g.label}
                        </label>
                    ))}
                </div>
            </div>

            {profiles.map(p => (
                <div key={p.name} style={{ ...box, ...row, justifyContent: "space-between" }}>
                    <div>
                        <HeadingTertiary>{p.name}</HeadingTertiary>
                        <Paragraph>{p.groups.map(g => GROUPS[g]?.label).filter(Boolean).join(", ") || "Custom"}</Paragraph>
                    </div>
                    <div style={row}>
                        <Button size="small" onClick={() => applyProfile(p)}>Apply</Button>
                        <Button size="small" variant="secondary" onClick={() => exportProfile(p)}>Export</Button>
                        <Button size="small" variant="dangerSecondary" onClick={() => persist(profiles.filter(x => x !== p))}>Delete</Button>
                    </div>
                </div>
            ))}

            <div style={{ ...row, marginBottom: 20 }}>
                <Button size="small" variant="secondary" onClick={importFile}>Import JSON</Button>
                <Button size="small" variant="secondary" onClick={() => exportProfile(snapshot("Current", Object.keys(GROUPS)))}>Export current</Button>
                <Button size="small" variant="dangerPrimary" onClick={resetAll}>Reset to defaults</Button>
            </div>
        </div>
    );
}
