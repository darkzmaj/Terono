/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { HeadingTertiary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { PluginNative } from "@utils/types";
import { createRoot, useEffect, useState } from "@webpack/common";
import type { CSSProperties } from "react";

import { TERONO_LOGO } from "./assets";
import { pluginsWaitingForRestart } from "./hub";
import { toast } from "./toast";
import type { UpdateState } from "./update";
import { VERSION } from "./version";

// only in the Discord app (the browser extension has no main process)
const Native = VencordNative.pluginHelpers.Terono as PluginNative<typeof import("./native")> | undefined;

const API = "https://api.github.com/repos/Terona-Studios/Terono/releases/latest";
const RELEASES = "https://github.com/Terona-Studios/Terono/releases/latest";
const STEPS = ["Downloading Terono", "Updating Vencord", "Installing packages", "Building"];

interface UpdateInfo {
    version?: string;
    notes?: string;
    url?: string;
    error?: string;
    canUpdate?: boolean;
    reason?: string;
}

export function isNewer(a: string, b: string) {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    // 3 or 4 parts (1.0.8.1 comes after 1.0.8 and before 1.0.9)
    for (let i = 0; i < 4; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
}

let lastInfo: UpdateInfo | null = null;

async function check(): Promise<UpdateInfo> {
    if (Native) return lastInfo = await Native.checkUpdate();
    try {
        const res = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) return lastInfo = { error: `GitHub answered ${res.status}` };
        const data = await res.json();
        const version = String(data.tag_name ?? "").replace(/^v/, "");
        return lastInfo = /^\d+(\.\d+){2,3}$/.test(version)
            ? { version, notes: String(data.body ?? "").slice(0, 2000), url: data.html_url, canUpdate: false }
            : { error: "No valid release found" };
    } catch (e) {
        return lastInfo = { error: `Couldn't reach GitHub (${(e as Error).message})` };
    }
}

const openExternal = (url: string) => VencordNative.native.openExternal(url);

// release notes are markdown; the panel shows them as short plain text
const plainNotes = (md: string) => md
    .replace(/\*\*|`|^#+\s*/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .split("\n").map(l => l.trimEnd()).filter((l, i, a) => l || a[i - 1]).slice(0, 14).join("\n").trim();

/* ================= settings panel ================= */

// plugins switched on or off (here or in Vencord's list) re-render the box; a stable array keeps one listener
const PLUGIN_PATHS = ["plugins.*"] as const;

export function UpdatePanel() {
    const [info, setInfo] = useState<UpdateInfo | null>(lastInfo);
    const [busy, setBusy] = useState(false);
    useEffect(ensureCss, []);
    useSettings(PLUGIN_PATHS as any);
    const waiting = pluginsWaitingForRestart();

    const run = async () => {
        setBusy(true);
        setInfo(await check());
        setBusy(false);
    };

    const newer = info?.version && isNewer(info.version, VERSION) ? info.version : null;
    const status = busy ? "Checking GitHub…"
        : info?.error ? `Couldn't check: ${info.error}`
            : newer ? (Native
                ? (info!.canUpdate ? `Terono ${newer} is out.` : `Terono ${newer} is out. ${info!.reason ?? ""}`)
                : `Terono ${newer} is out. Download the new browser zip and replace the files in your Terono folder.`)
                : info ? "✓ You're on the latest version." : "See if a new Terono release is out.";

    return (
        <div className="dz-upd-panel">
            <div className="dz-upd-row">
                <img src={TERONO_LOGO} alt="" className="dz-upd-panel-logo" />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <HeadingTertiary>Terono {VERSION}</HeadingTertiary>
                    <Paragraph className={newer ? "dz-upd-new" : undefined}>{status}</Paragraph>
                </div>
                {newer && Native && info!.canUpdate && <Button size="small" onClick={() => openUpdateScreen(newer)}>Update to {newer}</Button>}
                {newer && (!Native || !info!.canUpdate) && <Button size="small" variant="secondary" onClick={() => openExternal(info!.url ?? RELEASES)}>Open release</Button>}
                {!newer && <Button size="small" variant="secondary" disabled={busy} onClick={run}>{busy ? "Checking…" : "Check for updates"}</Button>}
            </div>
            {newer && info!.notes && <pre className="dz-upd-notes">{plainNotes(info!.notes)}</pre>}
            {waiting.length > 0 && (
                <div className="dz-upd-restart">
                    <span>Restart to apply: <b>{waiting.join(", ")}</b></span>
                    <Button size="small" onClick={() => location.reload()}>Restart Discord</Button>
                </div>
            )}
        </div>
    );
}

/* ================= automatic check + "updated" message ================= */

let timer = 0;
const notified = new Set<string>();

export function startAutoCheck(enabled: () => boolean, automatic: () => boolean) {
    const tick = async () => {
        if (!enabled() && !automatic()) return;
        const info = await check();
        const v = info.version;
        if (!v || !isNewer(v, VERSION) || notified.has(v)) return;
        notified.add(v);
        const canUpdate = !!Native && !!info.canUpdate;
        if (canUpdate && automatic() && await updateQuietly(v)) return;
        if (!enabled()) return;
        showNotification({
            title: "Terono update available",
            body: canUpdate ? `Terono ${v} is out. Click to update now.` : `Terono ${v} is out. Click to open the release.`,
            icon: TERONO_LOGO,
            onClick: () => canUpdate ? openUpdateScreen(v) : openExternal(info.url ?? RELEASES),
        });
    };
    window.setTimeout(tick, 15_000);
    timer = window.setInterval(tick, 6 * 60 * 60 * 1000);
}

// Automatic updates: the new version is downloaded and built in the background while Discord keeps running, and
// used from the next start. A restart right away is offered, never forced.
async function updateQuietly(version: string) {
    const started = await Native!.beginUpdate(version);
    if (!started.ok) return false;
    for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const s = await Native!.updateState();
        if (s.error) return false;
        if (s.done) {
            showNotification({
                title: `Terono ${version} is ready`,
                body: "Updated in the background. It starts with Discord next time; click to restart now.",
                icon: TERONO_LOGO,
                onClick: () => Native!.restartDiscord(),
            });
            return true;
        }
    }
    return false;
}

export function stopAutoCheck() {
    clearInterval(timer);
    closeUpdateScreen();
}

export function announceUpdated(last: string) {
    if (last && last !== VERSION && isNewer(VERSION, last))
        toast(`Terono updated to ${VERSION}`, "success");
}

/* ================= update screen ================= */

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

export function openUpdateScreen(version: string) {
    if (!Native) return;
    ensureCss();
    if (!host) {
        host = document.createElement("div");
        host.id = "terono-update-screen";
        document.body.append(host);
        root = createRoot(host);
    }
    root!.render(<UpdateScreen version={version} onClose={closeUpdateScreen} />);
}

function closeUpdateScreen() {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
}

function UpdateScreen({ version, onClose }: { version: string; onClose(): void; }) {
    const [state, setState] = useState<UpdateState | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [leaving, setLeaving] = useState(false);

    useEffect(() => {
        let alive = true;
        Native!.beginUpdate(version).then(r => {
            if (!r.ok && alive) setState({ running: false, step: -1, steps: STEPS, done: false, error: r.error, log: [] });
        });
        const poll = async () => {
            if (!alive) return;
            const s = await Native!.updateState();
            if (!alive) return;
            setState(s);
            if (!s.done && !s.error) setTimeout(poll, 350);
        };
        setTimeout(poll, 150);
        return () => { alive = false; };
    }, [attempt]);

    const phase = state?.error ? "error" : state?.done ? "done" : "running";
    const steps = state?.steps ?? STEPS;
    const step = Math.max(0, state?.step ?? 0);
    const progress = phase === "done" ? 100 : Math.min(96, ((step + 0.5) / steps.length) * 100);

    const close = () => {
        setLeaving(true);
        setTimeout(onClose, 200);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    const stepState = (i: number) => phase === "done" || i < step ? "done"
        : i === step ? (phase === "error" ? "error" : "active")
            : "pending";

    return (
        <div className={`dz-upd${leaving ? " dz-upd-leave" : ""}`} data-phase={phase}>
            <div className="dz-upd-glow" />
            <div className="dz-upd-card" role="dialog" aria-modal="true" aria-label="Terono update">
                <div className="dz-upd-logo">
                    <img src={TERONO_LOGO} alt="" />
                    {phase === "done" && (
                        <div className="dz-upd-burst">
                            {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
                        </div>
                    )}
                </div>

                <h2 key={`t-${phase}`} className="dz-upd-title">
                    {phase === "done" ? "Update ready" : phase === "error" ? "Update failed" : "Updating Terono"}
                </h2>
                <p key={`s-${phase}`} className="dz-upd-sub">
                    {phase === "done" ? `Terono ${version} is installed. Restart Discord to use it.`
                        : phase === "error" ? state!.error
                            : <>{VERSION} <span className="dz-upd-arrow">→</span> {version}</>}
                </p>

                <div className="dz-upd-bar"><div style={{ width: `${progress}%` }} /></div>

                <ol className="dz-upd-steps">
                    {steps.map((s, i) => (
                        <li key={s} data-state={stepState(i)}>
                            <span className="dz-upd-dot">
                                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5" /></svg>
                            </span>
                            {s}
                        </li>
                    ))}
                </ol>

                {phase === "error" && !!state?.log.length && <pre className="dz-upd-log">{state.log.slice(-6).join("\n")}</pre>}

                <div className="dz-upd-actions">
                    {phase === "done" && <>
                        <button className="dz-upd-btn dz-upd-primary" onClick={() => Native!.restartDiscord()}>Restart Discord</button>
                        <button className="dz-upd-btn" onClick={close}>Later</button>
                    </>}
                    {phase === "error" && <>
                        <button className="dz-upd-btn dz-upd-primary" onClick={() => { setState(null); setAttempt(a => a + 1); }}>Try again</button>
                        <button className="dz-upd-btn" onClick={close}>Close</button>
                    </>}
                    {phase === "running" && <button className="dz-upd-btn" onClick={close}>Hide</button>}
                </div>
                {phase === "running" && <p className="dz-upd-hint">You can keep using Discord. Hiding this doesn't stop the update.</p>}
            </div>
        </div>
    );
}

/* ================= styles ================= */

let css: HTMLStyleElement | null = null;

function ensureCss() {
    if (css?.isConnected) return;
    css = document.createElement("style");
    css.id = "terono-updater";
    css.textContent = CSS;
    document.head.append(css);
}

const CSS = `
.dz-upd-panel { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; margin-bottom: 8px; border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 3%, transparent); }
.dz-upd-row { display: flex; align-items: center; gap: 14px; }
.dz-upd-panel-logo { width: 40px; height: 40px; flex: none; }
.dz-upd-new { color: var(--dz-accent, #429cff) !important; font-weight: 600; }
.dz-upd-restart { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.4;
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-accent, #429cff) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--dz-accent, #429cff) 30%, transparent); animation: dz-upd-fade 200ms ease both; }
.dz-upd-restart > span { flex: 1; min-width: 0; }
.dz-upd-notes { margin: 0; padding: 10px 12px; max-height: 150px; overflow: auto; border-radius: 10px; background: rgb(0 0 0 / 22%);
    font: 12px/1.5 var(--font-primary, "gg sans", sans-serif); white-space: pre-wrap; color: color-mix(in srgb, var(--dz-text, #f1f2f4) 75%, transparent); }

.dz-upd { position: fixed; inset: 0; z-index: 100000; display: grid; place-items: center; overflow: hidden;
    background: rgb(0 0 0 / 55%); backdrop-filter: blur(10px); animation: dz-upd-in 260ms ease both;
    font-family: var(--font-primary, "gg sans", sans-serif); color: var(--dz-text, #f1f2f4); }
.dz-upd-leave { animation: dz-upd-out 200ms ease both; }
.dz-upd-glow { position: absolute; width: 680px; height: 680px; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle, color-mix(in srgb, var(--dz-accent, #429cff) 30%, transparent), transparent 62%);
    animation: dz-upd-breathe 3.4s ease-in-out infinite; }
.dz-upd[data-phase="error"] .dz-upd-glow { background: radial-gradient(circle, rgb(237 66 69 / 22%), transparent 62%); }

.dz-upd-card { position: relative; width: min(440px, calc(100vw - 32px)); padding: 32px 32px 22px; border-radius: 24px; text-align: center;
    background: color-mix(in srgb, var(--dz-card, #070708) 94%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #fff) 9%, transparent);
    box-shadow: 0 30px 90px rgb(0 0 0 / 60%), inset 0 1px 0 rgb(255 255 255 / 5%); animation: dz-upd-card 460ms cubic-bezier(.2, .9, .25, 1.15) both; }
.dz-upd-leave .dz-upd-card { animation: dz-upd-card-out 200ms ease both; }

.dz-upd-logo { position: relative; width: 108px; height: 108px; margin: 0 auto 18px; display: grid; place-items: center; }
.dz-upd-logo img { position: relative; width: 72px; height: 72px; }
.dz-upd[data-phase="done"] .dz-upd[data-phase="done"] .dz-upd-logo img { animation: dz-upd-pop 650ms cubic-bezier(.2, .9, .25, 1.45) both; }
.dz-upd[data-phase="error"] 
.dz-upd-burst i { position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; margin: -3.5px; border-radius: 50%; opacity: 0;
    background: var(--dz-accent, #429cff); box-shadow: 0 0 10px var(--dz-accent, #429cff);
    animation: dz-upd-burst 950ms cubic-bezier(.15, .8, .3, 1) calc(var(--i) * 12ms) both; }

.dz-upd-title { margin: 0 0 6px; font-size: 22px; font-weight: 800; letter-spacing: .01em; animation: dz-upd-fade 320ms ease both; }
.dz-upd-sub { margin: 0 0 20px; font-size: 14px; line-height: 1.45; color: color-mix(in srgb, var(--dz-text, #f1f2f4) 68%, transparent); animation: dz-upd-fade 320ms 60ms ease both; }
.dz-upd-arrow { color: var(--dz-accent, #429cff); margin: 0 4px; }

.dz-upd-bar { height: 6px; margin-bottom: 20px; border-radius: 99px; overflow: hidden; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-upd-bar > div { height: 100%; border-radius: inherit; background-size: 200% 100%; transition: width 650ms cubic-bezier(.2, .8, .2, 1);
    background-image: linear-gradient(90deg, var(--dz-accent, #429cff), color-mix(in srgb, var(--dz-accent, #429cff) 50%, white), var(--dz-accent, #429cff));
    animation: dz-upd-shimmer 1.4s linear infinite; }
.dz-upd[data-phase="done"] .dz-upd-bar > div { animation: none; background: var(--dz-accent, #429cff); }
.dz-upd[data-phase="error"] .dz-upd-bar > div { animation: none; background: rgb(237 66 69); }

.dz-upd-steps { display: grid; gap: 11px; margin: 0 0 22px; padding: 0 6px; list-style: none; text-align: left; }
.dz-upd-steps li { display: flex; align-items: center; gap: 12px; font-size: 14px; transition: color 250ms ease;
    color: color-mix(in srgb, var(--dz-text, #f1f2f4) 42%, transparent); }
.dz-upd-steps li:is([data-state="active"], [data-state="done"], [data-state="error"]) { color: var(--dz-text, #f1f2f4); }
.dz-upd-dot { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; box-sizing: border-box;
    border: 2px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 16%, transparent); transition: background 250ms ease, border-color 250ms ease; }
li[data-state="active"] .dz-upd-dot { border-color: color-mix(in srgb, var(--dz-accent, #429cff) 22%, transparent); border-top-color: var(--dz-accent, #429cff);
    animation: dz-upd-spin 800ms linear infinite; }
li[data-state="done"] .dz-upd-dot { background: var(--dz-accent, #429cff); border-color: var(--dz-accent, #429cff); animation: dz-upd-pop 380ms cubic-bezier(.2, .9, .25, 1.5) both; }
li[data-state="error"] .dz-upd-dot { background: rgb(237 66 69); border-color: rgb(237 66 69); }
.dz-upd-dot svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
li[data-state="done"] .dz-upd-dot svg { opacity: 1; }
li[data-state="done"] .dz-upd-dot path { stroke-dasharray: 12; stroke-dashoffset: 12; animation: dz-upd-draw 320ms 120ms ease forwards; }

.dz-upd-log { max-height: 110px; overflow: auto; margin: 0 0 18px; padding: 10px 12px; border-radius: 12px; text-align: left; white-space: pre-wrap;
    background: rgb(0 0 0 / 35%); font: 11px/1.5 var(--font-code, Consolas, monospace); color: color-mix(in srgb, var(--dz-text, #f1f2f4) 70%, transparent); }
.dz-upd-actions { display: flex; justify-content: center; gap: 10px; }
.dz-upd-btn { min-width: 112px; padding: 10px 18px; border-radius: 12px; cursor: pointer; font: 600 14px var(--font-primary, "gg sans", sans-serif); color: var(--dz-text, #f1f2f4);
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 12%, transparent); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent);
    transition: transform 120ms ease, background 150ms ease, box-shadow 150ms ease; }
.dz-upd-btn:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 11%, transparent); }
.dz-upd-btn:active { transform: scale(.97); }
.dz-upd-btn:focus-visible { outline: 2px solid var(--dz-accent, #429cff); outline-offset: 2px; }
.dz-upd-primary { color: #fff; border-color: transparent; background: var(--dz-accent, #429cff);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--dz-accent, #429cff) 40%, transparent); }
.dz-upd-primary:hover { background: color-mix(in srgb, var(--dz-accent, #429cff) 86%, white); }
.dz-upd-hint { margin: 14px 0 0; font-size: 12px; color: color-mix(in srgb, var(--dz-text, #f1f2f4) 45%, transparent); }

@keyframes dz-upd-in { from { opacity: 0; } }
@keyframes dz-upd-out { to { opacity: 0; } }
@keyframes dz-upd-card { from { opacity: 0; transform: translateY(18px) scale(.94); } }
@keyframes dz-upd-card-out { to { opacity: 0; transform: translateY(8px) scale(.97); } }
@keyframes dz-upd-spin { to { transform: rotate(1turn); } }
@keyframes dz-upd-breathe { 50% { transform: scale(1.08); opacity: .75; } }
@keyframes dz-upd-pop { 0% { transform: scale(.7); } 60% { transform: scale(1.14); } 100% { transform: scale(1); } }
@keyframes dz-upd-shake { 20%, 60% { transform: translateX(-4px); } 40%, 80% { transform: translateX(4px); } }
@keyframes dz-upd-burst {
    0% { opacity: 1; transform: rotate(calc(var(--i) * 30deg)) translateY(0) scale(1); }
    100% { opacity: 0; transform: rotate(calc(var(--i) * 30deg)) translateY(-84px) scale(.35); } }
@keyframes dz-upd-fade { from { opacity: 0; transform: translateY(5px); } }
@keyframes dz-upd-shimmer { to { background-position: -200% 0; } }
@keyframes dz-upd-draw { to { stroke-dashoffset: 0; } }

@media (prefers-reduced-motion: reduce) {
    .dz-upd, .dz-upd * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}`;
