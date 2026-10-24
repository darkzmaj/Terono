/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Terono settings screen: tabs by topic instead of one long list. Every option is still a normal Vencord
// setting (so profiles, reset and live apply work as before); this only decides where each one is shown, and
// draws it with Vencord's own setting controls.

import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { OptionComponentMap } from "@components/settings/tabs/plugins/components";
import { Modal, openModal, useEffect, useState } from "@webpack/common";

import { BADGES_CSS, BadgesPanel } from "./badges";
import { BRANDING_CSS } from "./branding";
import { COSMETICS_CSS } from "./cosmetics";
import { DEBUG_CSS } from "./diagnostics";
import { listedPlugins, PluginHub, Row } from "./hub";
import { applyPreset, Preset, presetMatches, PRESETS, presetValues } from "./presets";
import { startPreview } from "./preview";
import { PROFILES_CSS } from "./profiles";
import { loadFontPreviews, settings, useSettingsRevision } from "./settings";
import { toast } from "./toast";
import { TOOLS_CSS } from "./tools";
import { UpdatePanel } from "./updater";
import { USAGE_CSS } from "./usage";
import { VERSION } from "./version";

interface Group { title?: string; keys: string[]; }
interface Tab { id: string; label: string; section: string; icon: string; groups?: Group[]; }

// the sidebar: a few short sections instead of a wall of buttons
const TABS: Tab[] = [
    { id: "presets", section: "Look", label: "Presets", icon: "M4 5h16v4H4zM4 11h7v8H4zM13 11h7v8h-7z" },
    {
        id: "colors", section: "Look", label: "Colors", icon: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8Zm-5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z",
        groups: [
            { title: "Primary color", keys: ["accentPreset", "accent"] },
            { title: "Text", keys: ["customText", "textColor"] },
            { title: "Icons", keys: ["customIcons", "iconColor"] },
            { title: "Status & window buttons", keys: ["voice", "close", "minimize", "maximize"] },
            { title: "App border", keys: ["appBorder", "borderColor", "borderColor2", "appBorderFile", "appBorderWidth"] },
        ],
    },
    {
        id: "panels", section: "Look", label: "Panels & background", icon: "M3 5a2 2 0 0 1 2-2h5v18H5a2 2 0 0 1-2-2V5Zm9-2h7a2 2 0 0 1 2 2v6h-9V3Zm0 10h9v6a2 2 0 0 1-2 2h-7v-8Z",
        groups: [
            { title: "Panel colors", keys: ["cardPreset", "cardFill", "cardColor", "cardColor2", "cardAngle"] },
            { title: "Shape & material", keys: ["panels", "cardShape", "cardStyle", "glassOpacity", "glassBlur", "liquidColor", "liquidSpeed"] },
            { title: "Picture or video in the panels", keys: ["cardMedia", "cardMediaUrl", "cardMediaFile", "cardMediaDim"] },
            { title: "Embeds (link previews)", keys: ["embedStyle", "embedColor", "embedColor2", "embedAngle", "embedOpacity"] },
            { title: "Background", keys: ["background", "bgMediaSource", "bgMediaUrl", "bgMediaFile", "bgMediaDim", "bgBase", "bgColor1", "bgColor2"] },
        ],
    },
    {
        id: "fonts", section: "Look", label: "Font & logo", icon: "M5 4h14v3h-2V6h-4v12h2v2H9v-2h2V6H7v1H5V4Z",
        groups: [
            { title: "Font", keys: ["fontPicker", "fontFile"] },
            { title: "Home logo", keys: ["logoSource", "logoUrl", "logoFile", "logoSize"] },
            { title: "Icon & loading screens", keys: ["quickIcon", "loadingScreen"] },
            { title: "Your own pictures for Discord's buttons", keys: ["iconSwaps"] },
        ],
    },
    {
        id: "layout", section: "Look", label: "Layout", icon: "M4 4h6v16H4zM12 4h8v7h-8zM12 13h8v7h-8z",
        groups: [
            { title: "Where things sit", keys: ["serverList", "serverListDirection", "channelsSide", "membersSide"] },
            { title: "Messages", keys: ["chatSides"] },
            { title: "Channel header in servers", keys: ["headerName", "headerHash", "headerButtons", "headerSearch", "headerFollow"] },
            { title: "Channel header in DMs", keys: ["dmHeaderName", "dmHeaderButtons", "dmHeaderSearch"] },
            { title: "Hidden header buttons", keys: ["headerHiddenButtons"] },
            { title: "Chat bar buttons", keys: ["chatTranslate", "chatGif", "chatEmoji", "chatSticker", "chatGift", "chatApps", "chatOtherVencord"] },
            { title: "Member list & activities", keys: ["roleCount", "roleCountCustom", "showActivities"] },
            { title: "Right-click menus", keys: ["hiddenMenuItems", "hiddenServerMenu", "hiddenUserMenu"] },
        ],
    },
    { id: "profile", section: "You", label: "Your profile", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8c0-3.3 3.6-6 8-6s8 2.7 8 6v1H4v-1Z", groups: [{ keys: ["myLook"] }] },
    { id: "badges", section: "You", label: "Badges", icon: "M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.3 7.2 16.9l.9-5.4-3.9-3.8 5.4-.8L12 2Z" },
    {
        id: "people", section: "You", label: "People & avatars", icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-2.8 3.1-5 7-5s7 2.2 7 5v1H2v-1Zm16 1v-1c0-1.5-.6-2.8-1.7-3.9 2.8.3 4.7 1.9 4.7 3.9v1h-3Z",
        groups: [{ keys: ["people"] }, { title: "Names & profile pictures", keys: ["namesEverywhere", "avatarShape"] }],
    },
    {
        id: "calls", section: "Features", label: "Calls & overlay", icon: "M15 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2l5 3V5l-5 3Z",
        groups: [
            { title: "Streams (beta)", keys: ["callAmbient"] },
            { title: "Terono overlay (beta)", keys: ["overlayShow", "overlayKey", "overlayCorner", "overlayCompact", "overlayToasts", "overlayOpacity"] },
        ],
    },
    {
        id: "tools", section: "Features", label: "Tools", icon: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z",
        groups: [
            { title: "Search & friends", keys: ["searchTools", "blockedButton"] },
            { title: "Shortcuts", keys: ["openKeybind", "bulkMode", "homeDoubleClick"] },
            { title: "Translate", keys: ["autoTranslate", "keepLanguages"] },
        ],
    },
    { id: "plugins", section: "Features", label: "Plugins", icon: "M10 3h4v4h3a2 2 0 0 1 2 2v3h-4v4h4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3h4v-4H3V9a2 2 0 0 1 2-2h5V3Z" },
    { id: "profiles", section: "Terono", label: "Profiles & sharing", icon: "M6 3h9l4 4v14H6V3Zm8 1v4h4M9 12h7M9 16h7", groups: [{ keys: ["profiles"] }] },
    {
        id: "system", section: "Terono", label: "System", icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 4-2.1-.7-.5-1.3 1-2-2.1-2.1-2 1-1.3-.5L12 3h-1l-.7 2.1-1.3.5-2-1L4.9 6.8l1 2-.5 1.3L3 11v2l2.1.7.5 1.3-1 2 2.1 2.1 2-1 1.3.5L11 21h2l.7-2.1 1.3-.5 2 1 2.1-2.1-1-2 .5-1.3L21 13v-1Z",
        groups: [
            { title: "Troubleshooting", keys: ["debugInfo"] },
            { title: "Performance", keys: ["lite", "pauseUnfocused"] },
            { title: "Updates", keys: ["autoUpdate", "autoUpdateCheck"] },
            { title: "Taskbar", keys: ["taskbarIcon"] },
            { title: "Privacy", keys: ["shareUsage", "usageCount"] },
        ],
    },
];

const SECTIONS = [...new Set(TABS.map(t => t.section))];

let lastTab = "presets";

export const REPORT_URL = "https://darkzmaj.eu";

// only this plugin's settings (a stable array: a new one every render would re-subscribe every render)
const TERONO_PATHS = ["plugins.Terono.*"] as any[];

/* ================= screen ================= */

export function TeronoSettings() {
    const [tab, setTab] = useState(lastTab);
    const [query, setQuery] = useState("");
    const rev = useSettingsRevision();
    useSettings(TERONO_PATHS); // options that depend on others appear and disappear right away
    useEffect(() => {
        ensureCss();
        loadFontPreviews();
        return placeReportLink();
    }, []);

    const current = TABS.find(t => t.id === tab) ?? TABS[0];
    const pick = (id: string) => { lastTab = id; setTab(id); setQuery(""); };

    return (
        <div className="dz-set">
            <div className="dz-set-top">
                <input
                    className="dz-set-search"
                    type="search"
                    placeholder="Search settings and plugins"
                    value={query}
                    onChange={e => setQuery(e.currentTarget.value)}
                />
                <span className="dz-set-ver" title="Updates are in System">Terono {VERSION}</span>
            </div>
            <div className="dz-set-main">
                <nav className="dz-set-nav" role="tablist" aria-orientation="vertical">
                    {SECTIONS.map(sec => (
                        <div key={sec} className="dz-set-navsec">
                            <div className="dz-set-navhead">{sec}</div>
                            {TABS.filter(t => t.section === sec).map(t => (
                                <button key={t.id} role="tab" aria-selected={!query && t.id === current.id} className="dz-set-tab" onClick={() => pick(t.id)}>
                                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={t.icon} /></svg>
                                    <span>{t.label}</span>
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>
                {query.trim()
                    ? <SearchResults query={query} open={pick} />
                    : (
                        <div key={`${current.id}:${rev}`} className="dz-set-body">
                            <h2 className="dz-set-title">{current.label}</h2>
                            {(current.id === "system" || current.id === "plugins") && <UpdatePanel />}
                            {current.id === "presets" ? <PresetGallery /> : current.id === "plugins" ? <PluginHub /> : current.id === "badges" ? <BadgesPanel /> : current.groups!.map((g, i) => <GroupBox key={i} group={g} />)}
                        </div>
                    )}
            </div>
        </div>
    );
}

// "Found a bug?" goes at the very top of the plugin window, above Vencord's "Authors"
function placeReportLink() {
    const content = document.querySelector(".dz-set")?.closest(".vc-settings-modal-content");
    if (!content) return;
    const p = document.createElement("p");
    p.className = "dz-set-report";
    p.append("Need help or found a bug? ");
    const a = Object.assign(document.createElement("a"), { href: REPORT_URL, target: "_blank", rel: "noreferrer", textContent: "darkzmaj.eu" });
    p.append(a);
    content.prepend(p);
    return () => p.remove();
}

/* ================= search: every setting, preset and plugin ================= */

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

function SearchResults({ query, open }: { query: string; open(tab: string): void; }) {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const hit = (...texts: unknown[]) => { const t = norm(texts.join(" ")); return words.every(w => t.includes(w)); };
    const defs = settings.def as Record<string, any>;

    const groups = TABS.flatMap(tab => (tab.groups ?? []).map(g => ({
        tab, group: g,
        keys: g.keys.filter(k => visible(k) && hit(tab.label, g.title, k, defs[k]?.displayName, defs[k]?.dzLabel, defs[k]?.description, defs[k]?.dzNote)),
    }))).filter(g => g.keys.length);
    const tabs = TABS.filter(t => hit(t.label));
    const presets = PRESETS.filter(p => hit(p.name, p.description, "preset"));
    const plugins = listedPlugins().filter(p => hit(p.name, p.description)).slice(0, 25);

    if (!groups.length && !tabs.length && !presets.length && !plugins.length)
        return <p className="dz-set-empty">Nothing matches “{query}”.</p>;

    return (
        <div className="dz-set-body">
            {(tabs.length > 0 || presets.length > 0) && (
                <div className="dz-set-jump">
                    {tabs.map(t => <button key={t.id} onClick={() => open(t.id)}>{t.label} tab</button>)}
                    {presets.map(p => <button key={p.id} onClick={() => open("presets")}>Preset: {p.name}</button>)}
                </div>
            )}
            {groups.map(({ tab, group, keys }) => (
                <section key={`${tab.id}:${group.title}`} className="dz-set-group">
                    <h3 className="dz-set-group-title">{tab.label}{group.title ? ` › ${group.title}` : ""}</h3>
                    <div className="vc-plugins-settings">{keys.map(k => <Option key={k} id={k} />)}</div>
                </section>
            ))}
            {plugins.length > 0 && (
                <section className="dz-set-group">
                    <h3 className="dz-set-group-title">Plugins</h3>
                    <div className="dz-hub-list">{plugins.map(p => <Row key={p.name} plugin={p} />)}</div>
                </section>
            )}
        </div>
    );
}

function GroupBox({ group }: { group: Group; }) {
    const keys = group.keys.filter(visible);
    if (!keys.length) return null;
    return (
        <section className="dz-set-group">
            {group.title && <h3 className="dz-set-group-title">{group.title}</h3>}
            <div className="vc-plugins-settings">{keys.map(k => <Option key={k} id={k} />)}</div>
        </section>
    );
}

// each option keeps its own "show only when…" rule (moved to dzHidden, since `hidden` now keeps it out of the plain list)
function visible(id: string) {
    const def = (settings.def as Record<string, any>)[id];
    if (!def) return false;
    const rule = def.dzHidden;
    return !(typeof rule === "function" ? rule() : rule);
}

function Option({ id }: { id: string; }) {
    const def = (settings.def as Record<string, any>)[id];
    const Component = OptionComponentMap[def.type as keyof typeof OptionComponentMap] as any;
    return (
        <ErrorBoundary noop>
            <Component
                id={id}
                setting={def}
                onChange={(v: unknown) => { (settings.store as Record<string, unknown>)[id] = v; }}
                pluginSettings={settings.store}
                definedSettings={settings}
                closePluginSettings={() => { }}
            />
        </ErrorBoundary>
    );
}

/* ================= presets ================= */

// screenshots of each preset, from the release this plugin is (jsDelivr is on Vencord's default allow-list)
const thumb = (id: string) => `https://cdn.jsdelivr.net/gh/darkzmaj/Terono@v${VERSION}/assets/presets/${id}.jpg`;

function PresetGallery() {
    const basedOn = (settings.store as Record<string, unknown>).presetId as string | undefined;
    return (
        <div className="dz-presets">
            {PRESETS.map(p => {
                const active = presetMatches(p);
                const tag = active ? "In use" : p.id === basedOn ? "Customized" : null;
                return (
                    <div key={p.id} className={`dz-preset${active ? " dz-preset-active" : ""}`}>
                        <div className="dz-preset-img" style={{ background: swatch(p) }}>
                            <img src={thumb(p.id)} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = "none"; }} />
                            {tag && <span className="dz-preset-tag">{tag}</span>}
                        </div>
                        <div className="dz-preset-body">
                            <div className="dz-preset-name">{p.name}</div>
                            <div className="dz-preset-desc">{p.description}</div>
                        </div>
                        <div className="dz-preset-actions">
                            <Button size="small" variant="secondary" onClick={() => startPreview(p)}>Preview</Button>
                            <Button size="small" variant={active ? "secondary" : "primary"} onClick={() => confirmApply(p)}>
                                {active ? "Re-apply" : "Apply"}
                            </Button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// shown while the screenshot loads (or if it can't): the preset's own colors
function swatch(p: Preset) {
    const v = presetValues(p) as Record<string, string>;
    const card = v.cardPreset === "white" ? "#f4f5f7" : v.cardPreset === "gray" ? "#1e1f22" : v.cardPreset === "custom" ? v.cardColor : "#070708";
    return `radial-gradient(circle at 25% 30%, ${v.bgColor1}55, transparent 55%), radial-gradient(circle at 80% 75%, ${v.bgColor2}, transparent 60%), linear-gradient(${card}, ${card}) 12% 22% / 76% 60% no-repeat, ${v.bgBase}`;
}

// Discord's own alert no longer shows a third button, so the choice gets its own small dialog
function confirmApply(p: Preset) {
    const apply = (withLayout: boolean) => {
        applyPreset(p, withLayout);
        toast(`${p.name} applied${withLayout ? "" : " (your layout kept)"}. Change anything you like in the other tabs.`, "success");
    };
    openModal(props => (
        <Modal
            {...props}
            title={`Apply ${p.name}`}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: () => props.onClose() },
                { text: "Only the theme", variant: "secondary", onClick: () => { apply(false); props.onClose(); } },
                { text: "Theme + layout", variant: "primary", onClick: () => { apply(true); props.onClose(); } },
            ]}
        >
            <div className="dz-apply">
                <div className="dz-apply-img" style={{ background: swatch(p) }}>
                    <img src={thumb(p.id)} alt="" onError={e => { e.currentTarget.style.display = "none"; }} />
                </div>
                <p><b>Theme + layout:</b> colors, cards (color, corners, material), background and font, plus the preset's layout: server list position, channel and member list sides and the header.</p>
                <p><b>Only the theme:</b> colors, cards (color, corners, material), background and font. Your layout stays as it is.</p>
                <p className="dz-apply-note">Your logo, menus, chat bar buttons and other options stay either way. Not sure? Use Preview to try it on first. To keep your current look, save it under Profiles.</p>
            </div>
        </Modal>
    ));
}

/* ================= styles ================= */

let css: HTMLStyleElement | null = null;

function ensureCss() {
    if (css?.isConnected) return;
    css = document.createElement("style");
    css.id = "terono-settings-ui";
    css.textContent = CSS + BADGES_CSS + BRANDING_CSS + USAGE_CSS + COSMETICS_CSS + DEBUG_CSS + PROFILES_CSS + TOOLS_CSS;
    document.head.append(css);
}

const CSS = `
.dz-set { display: flex; flex-direction: column; gap: 12px; container-type: inline-size; }
.dz-set-top { display: flex; align-items: center; gap: 12px; }
.dz-set-ver { flex-shrink: 0; font: 600 12px var(--font-primary, "gg sans", sans-serif); color: var(--text-muted, #aaa); }
.dz-set-main { display: grid; grid-template-columns: 178px minmax(0, 1fr); gap: 18px; align-items: start; }
.dz-set-nav { position: sticky; top: 0; display: flex; flex-direction: column; gap: 12px; }
.dz-set-navsec { display: flex; flex-direction: column; gap: 2px; }
.dz-set-navhead { padding: 0 10px 4px; font: 700 11px var(--font-primary, "gg sans", sans-serif); letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted, #aaa); opacity: .8; }
.dz-set-tab { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border-radius: 10px; cursor: pointer; text-align: left;
    font: 600 13.5px var(--font-primary, "gg sans", sans-serif); color: var(--text-muted, #aaa); background: none; border: 0; transition: background 120ms ease, color 120ms ease; }
.dz-set-tab svg { flex-shrink: 0; opacity: .85; }
.dz-set-tab:hover { color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-set-tab[aria-selected="true"] { color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-accent, #429cff) 18%, transparent); box-shadow: inset 2px 0 0 var(--dz-accent, #429cff); }
.dz-set-tab[aria-selected="true"] svg { color: var(--dz-accent, #429cff); opacity: 1; }
.dz-set-tab:focus-visible { outline: 2px solid var(--dz-accent, #429cff); outline-offset: 1px; }
.dz-set-title { margin: 2px 0 0; font: 700 20px var(--font-primary, "gg sans", sans-serif); color: var(--text-default, #fff); }
@container (max-width: 620px) {
    .dz-set-main { grid-template-columns: 1fr; }
    .dz-set-nav { position: static; flex-direction: row; flex-wrap: wrap; gap: 4px; }
    .dz-set-navsec { flex-direction: row; flex-wrap: wrap; }
    .dz-set-navhead { display: none; }
    .dz-set-tab { width: auto; }
}
.dz-set-report { margin: -4px 0 0; text-align: center; font-size: 12px; color: var(--text-muted, #aaa); }
.dz-set-report a { color: var(--dz-accent, #429cff); }
.dz-set-search { width: 100%; box-sizing: border-box; height: 38px; padding: 0 14px; border-radius: 12px; font: 500 14px var(--font-primary, "gg sans", sans-serif);
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent);
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 10%, transparent); outline: none; transition: border-color 120ms ease; }
.dz-set-search:focus { border-color: var(--dz-accent, #429cff); }
.dz-set-search::placeholder { color: var(--text-muted, #aaa); }
.dz-set-empty { margin: 8px 0; text-align: center; color: var(--text-muted, #aaa); }
.dz-set-jump { display: flex; flex-wrap: wrap; gap: 6px; }
.dz-set-jump button { padding: 6px 12px; border-radius: 999px; cursor: pointer; font: 600 13px var(--font-primary, "gg sans", sans-serif); color: #fff; background: var(--dz-accent, #429cff); }
.vc-settings-modal-content > .dz-set-report { margin: 0 0 12px; text-align: left; font-size: 13px; }
.dz-set-intro { margin: 0; text-align: center; color: var(--text-muted, #aaa); font-size: 14px; }
.dz-set-body { display: flex; flex-direction: column; gap: 14px; animation: dz-set-in 180ms ease both; }
.dz-set-group { padding: 4px 16px 8px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent);
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 2.5%, transparent); }
.dz-set-group-title { margin: 12px 0 2px; font: 700 12px var(--font-primary, "gg sans", sans-serif); letter-spacing: .06em; text-transform: uppercase;
    color: var(--dz-accent, #429cff); }

.dz-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.dz-preset { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 3%, transparent);
    transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease; }
.dz-preset:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--dz-accent, #429cff) 45%, transparent);
    box-shadow: 0 10px 26px rgb(0 0 0 / 30%); }
.dz-preset-active { border-color: var(--dz-accent, #429cff); box-shadow: 0 0 0 1px var(--dz-accent, #429cff) inset; }
.dz-preset-img { position: relative; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; }
.dz-preset-img img { display: block; width: 100%; height: 100%; object-fit: cover; }
.dz-preset-tag { position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 999px; font: 700 11px var(--font-primary, "gg sans", sans-serif);
    color: #fff; background: var(--dz-accent, #429cff); box-shadow: 0 2px 8px rgb(0 0 0 / 35%); }
.dz-preset-body { flex: 1; min-height: 0; }
.dz-preset-name { font: 700 15px var(--font-primary, "gg sans", sans-serif); color: var(--text-default, #fff); }
.dz-preset-desc { margin-top: 3px; font-size: 13px; line-height: 1.4; color: var(--text-muted, #aaa); }
.dz-preset-actions { display: flex; gap: 8px; }
.dz-preset-actions > button { flex: 1; }

.dz-hub { display: flex; flex-direction: column; gap: 14px; }
.dz-hub-intro { margin: 0; color: var(--text-muted, #aaa); font-size: 14px; line-height: 1.45; }
.dz-hub-list { display: flex; flex-direction: column; padding: 4px 0 6px; }
.dz-hub-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-hub-row:first-child { border-top: none; }
.dz-hub-text { flex: 1; min-width: 0; }
.dz-hub-name { font: 600 15px var(--font-primary, "gg sans", sans-serif); color: var(--text-default, #fff); transition: color 120ms ease; }
.dz-hub-on .dz-hub-name { color: var(--dz-accent, #429cff); }
.dz-hub-desc { margin-top: 2px; font-size: 13px; line-height: 1.35; color: var(--text-muted, #aaa); }
.dz-fonts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; padding: 6px 0 12px; }
.dz-font { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; border-radius: 12px; cursor: pointer; text-align: left;
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); transition: border-color 120ms ease, background 120ms ease; }
.dz-font:hover { border-color: color-mix(in srgb, var(--dz-accent, #429cff) 50%, transparent); }
.dz-font[aria-checked="true"] { border-color: var(--dz-accent, #429cff); background: color-mix(in srgb, var(--dz-accent, #429cff) 14%, transparent); }
.dz-font-name { font-size: 15px; font-weight: 500; line-height: 1.25; }
.dz-font-sample { font-size: 12px; font-weight: 500; color: var(--text-muted, #aaa); }
.dz-debug { padding: 6px 0 12px; }
.dz-debug p { margin: 0 0 10px; font-size: 13px; line-height: 1.45; color: var(--text-muted, #aaa); }

.dz-hub-bar { display: flex; flex-direction: column; gap: 10px; }
.dz-hub-search { width: 100%; box-sizing: border-box; height: 40px; padding: 0 14px; border-radius: 12px; font: 500 15px var(--font-primary, "gg sans", sans-serif);
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent);
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 10%, transparent); outline: none; transition: border-color 140ms ease; }
.dz-hub-search:focus { border-color: var(--dz-accent, #429cff); }
.dz-hub-search::placeholder { color: var(--text-muted, #aaa); }
.dz-hub-filters { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.dz-hub-filter { padding: 5px 11px; border-radius: 999px; cursor: pointer; font: 600 12px var(--font-primary, "gg sans", sans-serif);
    color: var(--text-muted, #aaa); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent);
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); transition: background 140ms ease, color 140ms ease; }
.dz-hub-filter:hover { color: var(--text-default, #fff); }
.dz-hub-filter[aria-selected="true"] { color: #fff; border-color: transparent; background: var(--dz-accent, #429cff); }
.dz-hub-empty { margin: 8px 0; text-align: center; color: var(--text-muted, #aaa); }
.dz-hub-count { margin-left: 4px; opacity: .6; }
.dz-hub-tag { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 999px; vertical-align: 2px; font: 700 10px var(--font-primary, "gg sans", sans-serif);
    letter-spacing: .03em; text-transform: uppercase; color: var(--dz-accent, #429cff); background: color-mix(in srgb, var(--dz-accent, #429cff) 14%, transparent); }
.dz-hub-tag-restart { color: #f0b232; background: color-mix(in srgb, #f0b232 14%, transparent); }
.dz-hub-gear { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; padding: 0; border-radius: 8px; cursor: pointer;
    color: var(--interactive-icon-default, var(--text-muted, #aaa)); background: none; transition: background 120ms ease, color 120ms ease; }
.dz-hub-gear:hover { color: var(--interactive-icon-hover, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-hub-gear svg { width: 20px; height: 20px; }

.dz-apply { color: var(--text-default, #fff); }
.dz-apply-img { aspect-ratio: 16 / 9; margin-bottom: 14px; border-radius: 10px; overflow: hidden; }
.dz-apply-img img { display: block; width: 100%; height: 100%; object-fit: cover; }
.dz-apply p { margin: 0 0 10px; line-height: 1.45; }
.dz-apply-note { color: var(--text-muted, #aaa); font-size: 13px; }

@keyframes dz-set-in { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .dz-set-body { animation: none; } .dz-preset, .dz-set-tab { transition: none; } }`;
