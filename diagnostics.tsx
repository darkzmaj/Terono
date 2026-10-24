/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { gitHash } from "@shared/vencordUserAgent";
import { copyToClipboard } from "@utils/clipboard";
import { PluginNative } from "@utils/types";
import { Modal, openModal, useEffect, UserStore, useState } from "@webpack/common";

import { BADGE_API, badgesReady, OWNER_ID } from "./badgeConfig";
import { toast } from "./toast";
import { VERSION } from "./version";

/* ================= troubleshooting =================
   When Terono works on one PC and not on another, this finds out why: it times every start step, checks the usual
   causes one by one (with a fix button where Terono can fix it itself), and puts it all in a report. The report can
   be copied, or sent to the Terono server for a short support code to give the creator, who opens it in his own
   Terono. No messages, names or account details are in it. */

const errors: string[] = [];
const timings: [string, number][] = [];

// run one start step; a failing step is recorded instead of stopping everything after it, and every step is timed
export function safely(name: string, fn: () => unknown) {
    const t0 = performance.now();
    try {
        const r = fn();
        if (r instanceof Promise) r.then(() => timings.push([`${name} (async)`, performance.now() - t0]), e => recordError(name, e));
    } catch (e) {
        recordError(name, e);
    }
    timings.push([name, performance.now() - t0]);
}

export const startupTimes = () => timings.map(([n, ms]) => [n, Math.round(ms * 10) / 10] as const);

export function recordError(name: string, e: unknown) {
    const msg = `${name}: ${e instanceof Error ? e.message : String(e)}`;
    if (errors.length < 30) errors.push(msg);
    console.error("[Terono]", msg, e);
}

// the parts of Discord Terono positions and paints (their class names change with Discord updates)
const PARTS: Record<string, string> = {
    app: ".base__5e434",
    serverList: ".guilds__5e434",
    channelColumn: ".sidebar__5e434",
    channelList: ".sidebarList__5e434",
    userPanel: ".panels__5e434",
    page: ".page__5e434",
    header: ".chat_f75fb0 > .subtitleContainer_f75fb0",
    chat: ".chatContent_f75fb0",
    memberList: ".container_c8ffbb",
    titleBar: ".bar_c38106",
    background: "#app-mount .bg__960e4",
};

const THEME_RE = /terono|darkness/i;
const Native = IS_DISCORD_DESKTOP ? VencordNative.pluginHelpers.Terono as PluginNative<typeof import("./native")> : null;

function collect() {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const parts = Object.fromEntries(Object.entries(PARTS).map(([name, sel]) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return [name, "missing"];
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return [name, `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} ${cs.position}${cs.rotate !== "none" ? ` rotate ${cs.rotate}` : ""}`];
    }));
    const { profiles, peopleLooks, ...terono } = Settings.plugins.Terono as Record<string, unknown>;

    return {
        terono: VERSION,
        vencord: gitHash,
        client: IS_DISCORD_DESKTOP ? "desktop" : IS_VESKTOP ? "vesktop" : "web",
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        cpuThreads: navigator.hardwareConcurrency,
        memoryGB: (navigator as any).deviceMemory,
        releaseChannel: (window as any).GLOBAL_ENV?.RELEASE_CHANNEL,
        window: `${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        themeLinks: Settings.themeLinks,
        enabledThemes: Settings.enabledThemes,
        quickCss: Settings.useQuickCss,
        themeLoaded: themeLoaded(),
        pluginRunning: document.documentElement.hasAttribute("data-dz-plugin"),
        attributes: Object.fromEntries(Object.entries(document.documentElement.dataset).filter(([k]) => k.startsWith("dz"))),
        vars: { topBar: body.getPropertyValue("--custom-app-top-bar-height").trim(), guildWidth: body.getPropertyValue("--custom-guild-list-width").trim(), accent: root.getPropertyValue("--dz-accent").trim() },
        parts,
        otherPlugins: Object.values(plugins).filter(p => !p.required && p.name !== "Terono" && isPluginEnabled(p.name)).map(p => p.name).sort(),
        errors,
        startup: timings.map(([n, ms]) => `${n} ${ms.toFixed(1)}ms`),
        applyParts: (Settings.plugins.Terono as any) && (globalThis as any).Vencord?.Plugins?.plugins?.Terono?.applyTimes,
        settings: terono,
    };
}

// set by the theme file: tells whether it loaded at all
const themeLoaded = () => getComputedStyle(document.body).getPropertyValue("--top-bar-height").trim() !== "";

/* ---------- checks ---------- */

type Level = "ok" | "warn" | "fail";
interface Check { id: string; title: string; level: Level; detail: string; fix?: { label: string; run(): unknown | Promise<unknown>; }; }

async function runChecks(): Promise<Check[]> {
    const out: Check[] = [];
    const add = (c: Check) => out.push(c);

    add(themeLoaded()
        ? { id: "theme", title: "Terono theme", level: "ok", detail: "Loaded." }
        : { id: "theme", title: "Terono theme", level: "fail", detail: "The look isn't loaded, so colors and layout options do nothing.", fix: { label: "Reload Discord", run: () => location.reload() } });

    const extraLinks = Settings.themeLinks.filter(l => !THEME_RE.test(l));
    const extraFiles = Settings.enabledThemes.filter(f => !THEME_RE.test(f));
    const doubled = Settings.themeLinks.some(l => THEME_RE.test(l)) || Settings.enabledThemes.some(f => THEME_RE.test(f));
    if (doubled) add({
        id: "double", title: "Terono loaded twice", level: "warn", detail: "An online link or file of the Terono theme is on too; the plugin brings its own, so two copies fight.",
        fix: { label: "Remove the extra copy", run: () => { Settings.themeLinks = Settings.themeLinks.filter(l => !THEME_RE.test(l)); Settings.enabledThemes = Settings.enabledThemes.filter(f => !THEME_RE.test(f)); } },
    });
    add(extraLinks.length || extraFiles.length
        ? {
            id: "themes", title: "Other themes", level: "warn", detail: `${extraLinks.length + extraFiles.length} other theme(s) are on (${[...extraLinks.map(l => l.split("/").pop()), ...extraFiles].join(", ")}). They can override Terono's colors and layout.`,
            fix: { label: "Turn other themes off", run: () => { Settings.themeLinks = Settings.themeLinks.filter(l => THEME_RE.test(l)); Settings.enabledThemes = Settings.enabledThemes.filter(f => THEME_RE.test(f)); } },
        }
        : { id: "themes", title: "Other themes", level: "ok", detail: "None that could get in the way." });

    if (Settings.useQuickCss) {
        const css = await VencordNative.quickCss.get().catch(() => "");
        if (css.trim()) add({ id: "quickcss", title: "QuickCSS", level: "warn", detail: `Your QuickCSS is on (${css.length} characters) and is applied on top of Terono.`, fix: { label: "Turn QuickCSS off", run: () => { Settings.useQuickCss = false; } } });
    }

    if (!isPluginEnabled("ThemeAttributes")) add({ id: "attrs", title: "ThemeAttributes plugin", level: "warn", detail: "Terono needs it (messages left / right).", fix: { label: "Turn it on (restart)", run: () => { Settings.plugins.ThemeAttributes.enabled = true; toast("Restart Discord to finish.", "message"); } } });

    add(errors.length
        ? { id: "errors", title: "Start-up errors", level: "fail", detail: errors.join(" · "), fix: { label: "Reload Discord", run: () => location.reload() } }
        : { id: "errors", title: "Start-up", level: "ok", detail: "Every part of Terono started." });

    const missing = Object.entries(PARTS).filter(([, sel]) => !document.querySelector(sel)).map(([n]) => n).filter(n => n !== "memberList" && n !== "header" && n !== "chat");
    add(missing.length
        ? { id: "parts", title: "Discord's layout", level: "warn", detail: `Not found: ${missing.join(", ")}. Discord probably changed; an update of Terono fixes this.` }
        : { id: "parts", title: "Discord's layout", level: "ok", detail: "Terono finds every part it styles." });

    if (badgesReady()) {
        const ok = await fetch(`${BADGE_API}/badges`, { cache: "no-store" }).then(r => r.ok).catch(() => false);
        add(ok
            ? { id: "server", title: "Terono server", level: "ok", detail: "Reachable (badges, profiles, sharing)." }
            : { id: "server", title: "Terono server", level: "warn", detail: "Can't be reached: badges, profiles and sharing don't load. A firewall, VPN or ad blocker may block workers.dev." });
    }

    if (Native) {
        const info = await Native.checkUpdate().catch(() => null) as any;
        if (info?.version && info.version !== VERSION) add({ id: "update", title: "Update", level: "warn", detail: `Terono ${info.version} is out (you have ${VERSION}). Updates fix most problems.` });
        else if (info?.version) add({ id: "update", title: "Version", level: "ok", detail: `${VERSION} is the newest.` });
        if (info && info.canUpdate === false && info.reason) add({ id: "updater", title: "Updating inside Discord", level: "warn", detail: /Terono Setup/.test(info.reason) ? info.reason : `${info.reason} Run Terono Setup to repair it.` });
    }

    const slow = timings.filter(([n, ms]) => ms > 20 && !n.endsWith("(async)")).sort((a, b) => b[1] - a[1]);
    const total = timings.filter(([n]) => !n.endsWith("(async)")).reduce((a, [, ms]) => a + ms, 0);
    add({ id: "startup", title: "Start-up time", level: total > 400 ? "warn" : "ok", detail: `${Math.round(total)} ms${slow.length ? ` (slowest: ${slow.slice(0, 3).map(([n, ms]) => `${n} ${Math.round(ms)} ms`).join(", ")})` : ""}.` });

    const s = Settings.plugins.Terono as Record<string, any>;
    const heavy = !s.lite && (s.background === "media" || s.cardStyle === "liquid" || (s.cardStyle === "glass" && s.glassBlur));
    if (heavy && (navigator.hardwareConcurrency ?? 8) <= 4) add({
        id: "perf", title: "Performance", level: "warn", detail: "This PC is on the slower side and your look uses blur / moving light / a video background. Performance mode makes Discord much lighter.",
        fix: { label: "Turn on Performance mode", run: () => { s.lite = true; } },
    });

    return out;
}

/* ---------- repairs ---------- */

const CACHE_KEYS = ["Terono_badgeList"];

async function clearCaches() {
    for (const k of CACHE_KEYS) await DataStore.del(k);
    toast("Terono's caches are cleared. Reloading…", "success");
    setTimeout(() => location.reload(), 600);
}

function restart() {
    if (Native) Native.restartDiscord();
    else location.reload();
}

/* ---------- report ---------- */

async function report() {
    const checks = (await runChecks()).map(({ fix, ...c }) => c);
    return { ...collect(), checks, made: new Date().toISOString() };
}

async function sendReport() {
    const res = await fetch(`${BADGE_API}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report: await report() }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.code) throw new Error(body.error ?? `Error ${res.status}`);
    return body.code as string;
}

const LEVEL_ICON: Record<Level, string> = { ok: "✓", warn: "!", fail: "✕" };

export function DebugInfo() {
    const [checks, setChecks] = useState<Check[] | null>(null);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const rerun = () => { setChecks(null); runChecks().then(setChecks); };
    useEffect(rerun, []);

    const fixable = checks?.filter(c => c.fix && c.level !== "ok") ?? [];
    const isOwner = UserStore.getCurrentUser()?.id === OWNER_ID;

    return (
        <div className="dz-debug">
            <div className="dz-checks">
                {!checks && <p className="dz-look-note">Checking…</p>}
                {checks?.map(c => (
                    <div key={c.id} className={`dz-check dz-check-${c.level}`}>
                        <span className="dz-check-icon">{LEVEL_ICON[c.level]}</span>
                        <div className="dz-check-text"><b>{c.title}</b><span>{c.detail}</span></div>
                        {c.fix && c.level !== "ok" && <Button size="small" variant="secondary" onClick={async () => { await c.fix!.run(); rerun(); }}>{c.fix.label}</Button>}
                    </div>
                ))}
            </div>
            <div className="dz-debug-actions">
                <Button size="small" variant="secondary" onClick={rerun}>Check again</Button>
                {fixable.length > 1 && <Button size="small" onClick={async () => { for (const c of fixable) await c.fix!.run(); rerun(); }}>Fix all ({fixable.length})</Button>}
                <Button size="small" variant="secondary" onClick={clearCaches}>Clear Terono caches</Button>
                <Button size="small" variant="secondary" onClick={restart}>Restart Discord</Button>
            </div>

            <h3 className="dz-set-group-title">Get help</h3>
            <p>Still broken? Send your report and give the code to darkzmaj (<a href="https://darkzmaj.eu" target="_blank" rel="noreferrer">darkzmaj.eu</a>): it shows your Terono, Vencord and Discord versions, these checks, your window size and Terono settings. No messages, names or account details.</p>
            <div className="dz-debug-actions">
                <Button size="small" disabled={busy || !badgesReady()} onClick={async () => {
                    setBusy(true);
                    try {
                        const c = await sendReport();
                        setCode(c);
                        await copyToClipboard(c);
                        toast(`Sent. Your code ${c} is copied: give it to darkzmaj.`, "success");
                    } catch (e) {
                        toast(`Couldn't send: ${e instanceof Error ? e.message : e}. Use Copy report instead.`, "failure");
                    }
                    setBusy(false);
                }}>Send report</Button>
                <Button size="small" variant="secondary" onClick={async () => {
                    await copyToClipboard("```json\n" + JSON.stringify(await report(), null, 1) + "\n```");
                    toast("Copied. Send it to darkzmaj (darkzmaj.eu).", "success");
                }}>Copy report</Button>
                {code && <span className="dz-report-code">Your code: <b>{code}</b></span>}
            </div>

            {isOwner && <ReportLookup />}
        </div>
    );
}

// creator only: open someone's report by its code
function ReportLookup() {
    const [code, setCode] = useState("");
    async function open() {
        const { api } = await import("./badges");
        try {
            const { report: r, created } = await api(`/report/${encodeURIComponent(code.trim())}`);
            openModal(props => (
                <Modal {...props} title={`Report ${code.trim().toUpperCase()} · ${new Date(created).toLocaleString()}`} size="lg"
                    actions={[{ text: "Copy", variant: "secondary", onClick: () => copyToClipboard(JSON.stringify(r, null, 1)) }, { text: "Close", variant: "primary", onClick: () => props.onClose() }]}>
                    <div className="dz-checks">
                        {(r.checks ?? []).map((c: Check) => (
                            <div key={c.id} className={`dz-check dz-check-${c.level}`}><span className="dz-check-icon">{LEVEL_ICON[c.level]}</span><div className="dz-check-text"><b>{c.title}</b><span>{c.detail}</span></div></div>
                        ))}
                    </div>
                    <pre className="dz-report-json">{JSON.stringify({ ...r, checks: undefined }, null, 1)}</pre>
                </Modal>
            ));
        } catch (e) {
            toast(`Couldn't open: ${e instanceof Error ? e.message : e}`, "failure");
        }
    }
    return (
        <>
            <h3 className="dz-set-group-title">Open a report (only you)</h3>
            <div className="dz-debug-actions">
                <input className="dz-input" placeholder="Code, e.g. 4FL5YEGT" value={code} maxLength={8} onChange={e => setCode(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") open(); }} />
                <Button size="small" disabled={code.trim().length !== 8} onClick={open}>Open</Button>
            </div>
        </>
    );
}

export const DEBUG_CSS = `
.dz-checks { display: flex; flex-direction: column; gap: 6px; padding: 6px 0 10px; }
.dz-check { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 3.5%, transparent); }
.dz-check-icon { display: grid; place-items: center; width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; font: 800 12px var(--font-primary, "gg sans", sans-serif); color: #fff; }
.dz-check-ok .dz-check-icon { background: #23a55a; }
.dz-check-warn .dz-check-icon { background: #f0b232; }
.dz-check-fail .dz-check-icon { background: #f23f43; }
.dz-check-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; font-size: 13px; line-height: 1.4; color: var(--text-muted, #aaa); }
.dz-check-text b { color: var(--text-default, #fff); font-weight: 600; }
.dz-debug-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 4px 0 10px; }
.dz-report-code { font-size: 14px; color: var(--text-default, #fff); }
.dz-report-code b { letter-spacing: .1em; color: var(--dz-accent, #429cff); }
.dz-report-json { max-height: 40vh; overflow: auto; padding: 10px; border-radius: 10px; font-size: 11px; color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 4%, transparent); }
`;
