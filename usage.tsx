/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { FluxDispatcher, useEffect, UserStore, useState } from "@webpack/common";

import { BADGE_API, badgesReady, OWNER_ID } from "./badgeConfig";
import { api, authorize, getAuth, setPresence } from "./badges";
import { VERSION } from "./version";

// How many people use Terono: a number only the creator can read (Settings > Extras > Privacy).
// - "seen": about once a day the plugin sends a one-way hash of your Discord user ID (never the ID itself is stored);
// - "online": while Discord is open, the live connection to the badge server is marked as counted.
// The "Count me as a Terono user" setting turns both off completely.

const SEEN_KEY = "Terono_usageSeen";
const DAY = 24 * 60 * 60 * 1000;

export const isOwner = () => UserStore.getCurrentUser()?.id === OWNER_ID;

let share: () => boolean = () => false;
let timer = 0;

async function ping() {
    const id = UserStore.getCurrentUser()?.id;
    if (!share() || !badgesReady() || !id) return;
    const seen = await DataStore.get<Record<string, number>>(SEEN_KEY) ?? {};
    if (Date.now() - (seen[id] ?? 0) < DAY - 60 * 60 * 1000) return;
    try {
        const res = await fetch(`${BADGE_API}/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, v: VERSION }) });
        if (res.ok) await DataStore.set(SEEN_KEY, { ...seen, [id]: Date.now() });
    } catch { /* next time */ }
}

// call again whenever the setting changes
export function applyUsage() {
    setPresence(share());
    void ping();
}

const onConnect = () => applyUsage();

export function startUsage(shareUsage: () => boolean) {
    share = shareUsage;
    applyUsage();
    timer = window.setInterval(() => void ping(), 60 * 60 * 1000);
    FluxDispatcher.subscribe("CONNECTION_OPEN", onConnect);
}

export function stopUsage() {
    clearInterval(timer);
    FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnect);
    setPresence(false);
}

/* ================= the number (creator only) ================= */

interface Stats { online: number; day: number; total: number; }

export function UsagePanel() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [error, setError] = useState("");
    const [connected, setConnected] = useState<boolean | null>(null);

    useEffect(() => {
        if (!isOwner()) return;
        let alive = true;
        const load = async () => {
            if (!await getAuth()) { if (alive) setConnected(false); return; }
            try {
                const s = await api("/stats");
                if (alive) { setConnected(true); setStats(s); setError(""); }
            } catch (e) {
                if (alive) setError(e instanceof Error ? e.message : String(e));
            }
        };
        void load();
        const t = window.setInterval(load, 5000);
        return () => { alive = false; clearInterval(t); };
    }, []);

    if (!isOwner()) return null;

    return (
        <div className="dz-usage">
            {connected === false
                ? <Button size="small" onClick={async () => { if (await authorize()) setConnected(null); }}>Connect Discord to see the user count</Button>
                : (
                    <div className="dz-usage-grid">
                        <div><b>{stats ? stats.online : "…"}</b><span>online now</span></div>
                        <div><b>{stats ? stats.day : "…"}</b><span>active in 24 h</span></div>
                        <div><b>{stats ? stats.total : "…"}</b><span>users in total</span></div>
                    </div>
                )}
            {error && <p className="dz-usage-err">{error}</p>}
            <p className="dz-usage-note">Only you can see this. Updates every few seconds. Counts people who left "Count me as a Terono user" on.</p>
        </div>
    );
}

export const USAGE_CSS = `
.dz-usage { padding: 6px 0 12px; }
.dz-usage-grid { display: flex; gap: 10px; flex-wrap: wrap; }
.dz-usage-grid > div { flex: 1; min-width: 110px; padding: 10px 12px; border-radius: 12px; display: flex; flex-direction: column; gap: 2px;
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-usage-grid b { font: 700 26px var(--font-primary, "gg sans", sans-serif); color: var(--dz-accent, #429cff); }
.dz-usage-grid span, .dz-usage-note { font-size: 12px; color: var(--text-muted, #aaa); }
.dz-usage-note { margin: 10px 0 0; }
.dz-usage-err { margin: 8px 0 0; font-size: 12px; color: #f23f43; }`;
