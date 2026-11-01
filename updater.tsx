/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
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

const API = "https://api.github.com/repos/darkzmaj/Terono/releases/latest";
const RELEASES = "https://github.com/darkzmaj/Terono/releases/latest";
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
                    <h3 className="dz-h3">Terono {VERSION}</h3>
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

    const RING = 2 * Math.PI * 52;
    return (
        <div className={`dz-upd${leaving ? " dz-upd-leave" : ""}`} data-phase={phase}>
            <div className="dz-upd-card" role="dialog" aria-modal="true" aria-label="Terono update">
                <div className="dz-upd-logo">
                    <svg className="dz-upd-ring" viewBox="0 0 120 120" aria-hidden="true">
                        <circle className="dz-upd-track" cx="60" cy="60" r="52" />
                        <circle className="dz-upd-fill" cx="60" cy="60" r="52" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - progress / 100) }} />
                    </svg>
                    {phase === "running" && <span className="dz-upd-orbit" aria-hidden="true" />}
                    <img src={TERONO_LOGO} alt="" />
                    {phase === "done" && (
                        <span className="dz-upd-check" aria-hidden="true">
                            <svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5" /></svg>
                        </span>
                    )}
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
                            : <><span className="dz-upd-ver">{VERSION}</span><span className="dz-upd-arrow">→</span><span className="dz-upd-ver dz-upd-ver-new">{version}</span></>}
                </p>

                <ol className="dz-upd-steps">
                    {steps.map((s, i) => (
                        <li key={s} data-state={stepState(i)} style={{ "--i": i } as CSSProperties}>
                            <span className="dz-upd-dot">
                                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5" /></svg>
                            </span>
                            <span className="dz-upd-step">{s}</span>
                        </li>
                    ))}
                </ol>
                {phase === "running" && <p className="dz-upd-count">Step {Math.min(step + 1, steps.length)} of {steps.length}</p>}

                {phase === "error" && !!state?.log.length && <pre className="dz-upd-log">{state.log.slice(-6).join("\n")}</pre>}

                <div className="dz-upd-actions">
                    {phase === "done" && <>
                        <button className="dz-upd-btn" onClick={close}>Later</button>
                        <button className="dz-upd-btn dz-upd-primary" onClick={() => Native!.restartDiscord()}>Restart Discord</button>
                    </>}
                    {phase === "error" && <>
                        <button className="dz-upd-btn" onClick={close}>Close</button>
                        <button className="dz-upd-btn dz-upd-primary" onClick={() => { setState(null); setAttempt(a => a + 1); }}>Try again</button>
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

/* the update screen: a Terono card over a dimmed Discord. The logo sits in a ring that fills as the update goes,
   with a soft arc running round it; done, the logo springs and a check pops in. No blur behind the whole window
   (redoing it on every frame of the open animation is what made it stutter). */
.dz-upd { position: fixed; inset: 0; z-index: 100000; display: grid; place-items: center; overflow: hidden; padding: 16px;
    background: radial-gradient(ellipse at center, color-mix(in srgb, var(--dz-accent, #429cff) 14%, rgb(0 0 0 / 62%)), rgb(0 0 0 / 74%) 70%);
    animation: dz-upd-in 240ms ease both; font-family: var(--font-primary, "gg sans", sans-serif); color: var(--dz-text, #f1f2f4); }
.dz-upd-leave { animation: dz-upd-out 180ms ease both; }

.dz-upd-card { position: relative; width: min(420px, 100%); box-sizing: border-box; padding: 30px 28px 22px; border-radius: var(--radius-xl, 24px); text-align: center;
    background: linear-gradient(var(--dz-card-angle, 160deg), var(--dz-card, #070708), var(--dz-card-2, #0b1a33));
    border: 1px solid color-mix(in srgb, var(--dz-text, #fff) 9%, transparent);
    box-shadow: 0 28px 80px rgb(0 0 0 / 55%), inset 0 1px 0 rgb(255 255 255 / 6%);
    animation: dz-upd-card 520ms cubic-bezier(.34, 1.45, .5, 1) both; }
.dz-upd-card::before { content: ""; position: absolute; inset: 0 22% auto; height: 1px; border-radius: 1px; pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--dz-accent, #429cff), transparent); opacity: .8; }
.dz-upd-leave .dz-upd-card { animation: dz-upd-card-out 180ms ease both; }
.dz-upd[data-phase="error"] .dz-upd-card { animation: dz-upd-card 520ms cubic-bezier(.34, 1.45, .5, 1) both, dz-upd-shake 420ms 80ms ease both; }

.dz-upd-logo { position: relative; width: 120px; height: 120px; margin: 0 auto 16px; display: grid; place-items: center; }
.dz-upd-logo img { position: relative; width: 62px; height: 62px; transition: scale 400ms cubic-bezier(.34, 1.6, .5, 1); }
.dz-upd[data-phase="done"] .dz-upd-logo img { animation: dz-upd-pop 620ms cubic-bezier(.34, 1.6, .5, 1) both; }
.dz-upd-ring { position: absolute; inset: 0; rotate: -90deg; overflow: visible; }
.dz-upd-ring circle { fill: none; stroke-width: 5; stroke-linecap: round; }
.dz-upd-track { stroke: color-mix(in srgb, var(--dz-text, #f1f2f4) 9%, transparent); }
.dz-upd-fill { stroke: var(--dz-accent, #429cff); filter: drop-shadow(0 0 6px color-mix(in srgb, var(--dz-accent, #429cff) 60%, transparent));
    transition: stroke-dashoffset 700ms cubic-bezier(.34, 1.25, .5, 1), stroke 250ms ease; }
.dz-upd[data-phase="error"] .dz-upd-fill { stroke: #ed4245; filter: none; }
.dz-upd-orbit { position: absolute; inset: -7px; border-radius: 50%; pointer-events: none;
    background: conic-gradient(from 0deg, transparent 0 70%, color-mix(in srgb, var(--dz-accent, #429cff) 70%, white) 92%, transparent);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
    animation: dz-upd-spin 1.15s cubic-bezier(.55, .1, .45, .9) infinite; }
.dz-upd-check { position: absolute; right: 14px; bottom: 14px; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%;
    background: var(--dz-accent, #429cff); box-shadow: 0 0 0 4px var(--dz-card, #070708), 0 6px 16px color-mix(in srgb, var(--dz-accent, #429cff) 50%, transparent);
    animation: dz-upd-pop 520ms 160ms cubic-bezier(.34, 1.8, .5, 1) both; }
.dz-upd-check svg { width: 15px; height: 15px; fill: none; stroke: #fff; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.dz-upd-check path { stroke-dasharray: 12; stroke-dashoffset: 12; animation: dz-upd-draw 300ms 420ms ease forwards; }
.dz-upd-burst i { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%; opacity: 0;
    background: var(--dz-accent, #429cff); box-shadow: 0 0 10px var(--dz-accent, #429cff);
    animation: dz-upd-burst 900ms cubic-bezier(.15, .8, .3, 1) calc(var(--i) * 14ms) both; }

.dz-upd-title { margin: 0 0 6px; font-size: 21px; font-weight: 800; letter-spacing: .01em; animation: dz-upd-fade 320ms ease both; }
.dz-upd-sub { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; font-size: 14px; line-height: 1.45;
    color: color-mix(in srgb, var(--dz-text, #f1f2f4) 68%, transparent); animation: dz-upd-fade 320ms 60ms ease both; }
.dz-upd-ver { padding: 3px 10px; border-radius: 999px; font-weight: 700; font-size: 13px; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 7%, transparent); }
.dz-upd-ver-new { color: #fff; background: var(--dz-accent, #429cff); }
.dz-upd-arrow { color: var(--dz-accent, #429cff); font-weight: 700; }

.dz-upd-steps { display: grid; gap: 4px; margin: 0 0 6px; padding: 0; list-style: none; text-align: left; }
.dz-upd-steps li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 12px; font-size: 14px;
    color: color-mix(in srgb, var(--dz-text, #f1f2f4) 40%, transparent); transition: color 250ms ease, background 250ms ease;
    animation: dz-upd-fade 360ms calc(120ms + var(--i) * 50ms) ease both; }
.dz-upd-steps li[data-state="active"] { color: var(--dz-text, #f1f2f4); background: color-mix(in srgb, var(--dz-accent, #429cff) 10%, transparent); }
.dz-upd-steps li:is([data-state="done"], [data-state="error"]) { color: var(--dz-text, #f1f2f4); }
li[data-state="active"] .dz-upd-step { background: linear-gradient(90deg, var(--dz-text, #f1f2f4) 40%, var(--dz-accent, #429cff) 50%, var(--dz-text, #f1f2f4) 60%);
    background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: dz-upd-shimmer 1.6s linear infinite; }
.dz-upd-dot { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; box-sizing: border-box;
    border: 2px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 16%, transparent); transition: background 250ms ease, border-color 250ms ease; }
li[data-state="active"] .dz-upd-dot { border-color: color-mix(in srgb, var(--dz-accent, #429cff) 22%, transparent); border-top-color: var(--dz-accent, #429cff);
    animation: dz-upd-spin 750ms linear infinite; }
li[data-state="done"] .dz-upd-dot { background: var(--dz-accent, #429cff); border-color: var(--dz-accent, #429cff); animation: dz-upd-pop 420ms cubic-bezier(.34, 1.8, .5, 1) both; }
li[data-state="error"] .dz-upd-dot { background: #ed4245; border-color: #ed4245; }
.dz-upd-dot svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
li[data-state="done"] .dz-upd-dot svg { opacity: 1; }
li[data-state="done"] .dz-upd-dot path { stroke-dasharray: 12; stroke-dashoffset: 12; animation: dz-upd-draw 300ms 120ms ease forwards; }
.dz-upd-count { margin: 0 0 16px; font-size: 12px; font-weight: 600; color: color-mix(in srgb, var(--dz-text, #f1f2f4) 45%, transparent); }

.dz-upd-log { max-height: 110px; overflow: auto; margin: 10px 0 18px; padding: 10px 12px; border-radius: 12px; text-align: left; white-space: pre-wrap;
    background: rgb(0 0 0 / 35%); font: 11px/1.5 var(--font-code, Consolas, monospace); color: color-mix(in srgb, var(--dz-text, #f1f2f4) 70%, transparent); }
.dz-upd-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.dz-upd-btn { min-width: 120px; padding: 10px 18px; border-radius: 12px; cursor: pointer; font: 600 14px var(--font-primary, "gg sans", sans-serif); color: var(--dz-text, #f1f2f4);
    border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 12%, transparent); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent);
    transition: scale 220ms cubic-bezier(.34, 1.56, .64, 1), background 150ms ease, box-shadow 150ms ease; }
.dz-upd-btn:hover { scale: 1.03; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 11%, transparent); }
.dz-upd-btn:active { scale: .96; transition-duration: 90ms; }
.dz-upd-btn:focus-visible { outline: 2px solid var(--dz-accent, #429cff); outline-offset: 2px; }
.dz-upd-primary { color: #fff; border-color: transparent; background: var(--dz-accent, #429cff);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--dz-accent, #429cff) 40%, transparent); }
.dz-upd-primary:hover { background: color-mix(in srgb, var(--dz-accent, #429cff) 86%, white); }
.dz-upd-hint { margin: 14px 0 0; font-size: 12px; color: color-mix(in srgb, var(--dz-text, #f1f2f4) 45%, transparent); }

@keyframes dz-upd-in { from { opacity: 0; } }
@keyframes dz-upd-out { to { opacity: 0; } }
@keyframes dz-upd-card { from { opacity: 0; transform: translateY(22px) scale(.92); } }
@keyframes dz-upd-card-out { to { opacity: 0; transform: translateY(8px) scale(.96); } }
@keyframes dz-upd-spin { to { transform: rotate(1turn); } }
@keyframes dz-upd-pop { 0% { scale: .6; } 55% { scale: 1.16; } 100% { scale: 1; } }
@keyframes dz-upd-shake { 20%, 60% { translate: -6px 0; } 40%, 80% { translate: 6px 0; } }
@keyframes dz-upd-burst {
    0% { opacity: 1; transform: rotate(calc(var(--i) * 30deg)) translateY(-40px) scale(1); }
    100% { opacity: 0; transform: rotate(calc(var(--i) * 30deg)) translateY(-92px) scale(.3); } }
@keyframes dz-upd-fade { from { opacity: 0; transform: translateY(6px); } }
@keyframes dz-upd-shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@keyframes dz-upd-draw { to { stroke-dashoffset: 0; } }

@media (prefers-reduced-motion: reduce) {
    .dz-upd, .dz-upd * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}`;
