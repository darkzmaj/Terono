/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { openUserProfile } from "@utils/discord";
import { FluxDispatcher, Modal, openModal, useEffect, UserStore, UserUtils, useState } from "@webpack/common";

import { BADGE_API, badgesReady, OWNER_ID } from "./badgeConfig";
import { api, authorize, getAuth, setPresence } from "./badges";
import { VERSION } from "./version";

// Who uses Terono (Settings > System > Privacy).
// - "Count me as a Terono user": about once a day a one-way hash of your Discord user ID is counted (the number only the
//   creator can read), and while Discord is open the live connection is marked as online.
// - The Terono mark: your Discord user ID is known to the server as a Terono user, so other Terono users see the mark
//   on your profile. Always on.
// - "Show me in the Terono user list": the creator may see you (username, picture) in the user list. Asked once and
//   off until you answer; turning it off takes you off the list.

const SEEN_KEY = "Terono_usageSeen";
const DAY = 24 * 60 * 60 * 1000;

export const isOwner = () => UserStore.getCurrentUser()?.id === OWNER_ID;

interface UsageSettings { shareUsage: boolean; showAsTerono: boolean; memberNoticed: boolean; }
let store: UsageSettings | null = null;
const share = () => !!store?.shareUsage;
// in the creator's list only once the notice was answered
const listed = () => !!store?.showAsTerono && !!store?.memberNoticed;
let timer = 0;

async function ping() {
    const id = UserStore.getCurrentUser()?.id;
    if (!badgesReady() || !id) return;
    const count = share(), list = listed();
    const seen = await DataStore.get<Record<string, number | { t: number; m: boolean; }>>(SEEN_KEY) ?? {};
    const last = seen[id];
    const lastT = typeof last === "number" ? 0 : last?.t ?? 0;
    const lastM = typeof last === "object" ? last.m : undefined;
    // once a day, and right away when the list choice changes
    if (lastM === list && Date.now() - lastT < DAY - 60 * 60 * 1000) return;
    try {
        const res = await fetch(`${BADGE_API}/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, v: VERSION, count, member: true, listed: list }) });
        if (res.ok) await DataStore.set(SEEN_KEY, { ...seen, [id]: { t: Date.now(), m: list } });
    } catch { /* next time */ }
}

// call again whenever a setting changes
export function applyUsage() {
    setPresence(share());
    void ping();
}

/* ---------- the one-time notice ---------- */

function askOnce() {
    if (!store || !store.showAsTerono || store.memberNoticed) return;
    const answer = (keep: boolean) => { store!.showAsTerono = keep; store!.memberNoticed = true; applyUsage(); };
    openModal(props => (
        <Modal {...props} title="New in Terono: the Terono mark" size="sm"
            actions={[
                { text: "Keep me off the list", variant: "secondary", onClick: () => { answer(false); props.onClose(); } },
                { text: "OK", variant: "primary", onClick: () => { answer(true); props.onClose(); } },
            ]}>
            <div className="dz-usage-ask">
                <p>Terono users now see a small Terono mark on each other's profiles, so you can tell who uses Terono. For that, the Terono server knows your Discord user ID is a Terono user.</p>
                <p>darkzmaj (Terono's creator) also has a list of Terono users with their username and profile picture. Are you OK being on it?</p>
                <p>You can change this any time in Terono settings → System → Privacy → <b>Show me in the Terono user list</b>. You're not on the list until you choose.</p>
            </div>
        </Modal>
    ));
}

/* ---------- is someone a Terono user (the mark on profiles) ---------- */

const marks = new Map<string, boolean>();
const asking = new Map<string, Promise<boolean>>();

export function isTeronoUser(id: string): Promise<boolean> {
    if (id === UserStore.getCurrentUser()?.id) return Promise.resolve(true);
    const known = marks.get(id);
    if (known !== undefined) return Promise.resolve(known);
    let p = asking.get(id);
    if (!p) {
        p = fetch(`${BADGE_API}/member/${id}`).then(r => r.ok ? r.json() : { t: 0 }).then(b => !!b.t, () => false).then(t => { marks.set(id, t); asking.delete(id); return t; });
        asking.set(id, p);
    }
    return p;
}

const onConnect = () => applyUsage();

export function startUsage(settingsStore: UsageSettings) {
    store = settingsStore;
    applyUsage();
    setTimeout(askOnce, 8000);
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
            {connected && <Button size="small" style={{ marginTop: 10 }} onClick={openMembers}>See who uses Terono</Button>}
            <p className="dz-usage-note">Only you can see this. Updates every few seconds. Counts people who left "Count me as a Terono user" on; the list shows people who allow "Show me in the Terono user list".</p>
        </div>
    );
}

/* ================= who uses Terono (creator only) ================= */

interface Member { id: string; first: number; last: number; online: boolean; }

function MemberRow({ m }: { m: Member; }) {
    const [user, setUser] = useState<any>(() => UserStore.getUser(m.id));
    useEffect(() => { if (!user) UserUtils.getUser(m.id).then(setUser, () => { }); }, []);
    const name = user?.globalName || user?.username || m.id;
    return (
        <button className="dz-mem" onClick={() => openUserProfile(m.id)}>
            <span className="dz-mem-pic">
                {user ? <img src={user.getAvatarURL?.(undefined, 80) ?? ""} alt="" /> : null}
                {m.online && <i className="dz-mem-on" title="Online now" />}
            </span>
            <span className="dz-mem-text">
                <b>{name}</b>
                <small>{user ? `@${user.username}` : "Loading…"} · {m.id}</small>
            </span>
            <span className="dz-mem-when">
                <small>{m.online ? "Online now" : `Last seen ${new Date(m.last).toLocaleDateString()}`}</small>
                <small>Since {new Date(m.first).toLocaleDateString()}</small>
            </span>
        </button>
    );
}

function MembersList() {
    const [rows, setRows] = useState<Member[] | null>(null);
    const [error, setError] = useState("");
    const [q, setQ] = useState("");
    useEffect(() => { api("/members").then(setRows, (e: any) => setError(e instanceof Error ? e.message : String(e))); }, []);
    const w = q.trim().toLowerCase();
    const shown = (rows ?? []).filter(m => {
        if (!w) return true;
        const u = UserStore.getUser(m.id) as any;
        return `${m.id} ${u?.username ?? ""} ${u?.globalName ?? ""}`.toLowerCase().includes(w);
    });
    return (
        <div className="dz-mems">
            <input className="dz-input" placeholder="Search by name or ID" value={q} onChange={e => setQ(e.currentTarget.value)} />
            {error && <p className="dz-usage-err">{error}</p>}
            {!rows && !error && <p className="dz-usage-note">Loading…</p>}
            {rows && <p className="dz-usage-note">{rows.length} people · {rows.filter(r => r.online).length} online now. Click someone to open their profile.</p>}
            <div className="dz-mems-list">{shown.map(m => <MemberRow key={m.id} m={m} />)}</div>
        </div>
    );
}

function openMembers() {
    openModal(props => <Modal {...props} title="Who uses Terono" size="md"><MembersList /></Modal>);
}

export const USAGE_CSS = `
.dz-usage { padding: 6px 0 12px; }
.dz-usage-grid { display: flex; gap: 10px; flex-wrap: wrap; }
.dz-usage-grid > div { flex: 1; min-width: 110px; padding: 10px 12px; border-radius: 12px; display: flex; flex-direction: column; gap: 2px;
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-usage-grid b { font: 700 26px var(--font-primary, "gg sans", sans-serif); color: var(--dz-accent, #429cff); }
.dz-usage-grid span, .dz-usage-note { font-size: 12px; color: var(--text-muted, #aaa); }
.dz-usage-note { margin: 10px 0 0; }
.dz-usage-err { margin: 8px 0 0; font-size: 12px; color: #f23f43; }
.dz-usage-ask p { margin: 0 0 10px; font-size: 14px; line-height: 1.45; color: var(--text-default, #fff); }
.dz-mems { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; }
.dz-mems .dz-usage-note { margin: 0; }
.dz-mems-list { display: flex; flex-direction: column; gap: 2px; max-height: 60vh; overflow-y: auto; scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--dz-accent, #429cff) 50%, transparent) transparent; }
.dz-mem { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 10px; border: 0; border-radius: 10px; cursor: pointer; text-align: left;
    background: transparent; color: var(--text-default, #fff); font: inherit; }
.dz-mem:hover { background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-mem-pic { position: relative; flex: none; width: 40px; height: 40px; border-radius: 50%; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-mem-pic img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.dz-mem-on { position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 50%; background: #23a55a; box-shadow: 0 0 0 3px var(--modal-background, #1e1f22); }
.dz-mem-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dz-mem-text b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-mem-text small, .dz-mem-when small { font-size: 12px; color: var(--text-muted, #aaa); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-mem-when { flex: none; display: flex; flex-direction: column; align-items: flex-end; }`;
