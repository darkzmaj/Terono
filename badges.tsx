/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { FluxDispatcher, OAuth2AuthorizeModal, openModal, showToast, Toasts, useEffect, UserStore, useState } from "@webpack/common";

import { OG_BADGE } from "./assets";
import { BADGE_API, BADGE_CLIENT_ID, badgesReady } from "./badgeConfig";
import { VERSION } from "./version";

/* ================= where the badges live =================
   A small Cloudflare Worker (server/ in this repo) keeps who wears which Terono badge. Everyone who runs Terono
   downloads that list and shows the badges on profiles; only Terono users see them. Changing your own badges needs
   a one-time "Authorize" in Discord, so nobody can put badges on someone else's profile. */


const CACHE_KEY = "Terono_badgeList";
const AUTH_KEY = "Terono_badgeAuth";
const HELLO_KEY = "Terono_badgeHello";
// changes arrive live; the full list is only downloaded at start, after a reconnect and every few hours
const REFRESH_MS = 6 * 60 * 60 * 1000;
export const MAX_CUSTOM = 3;

// official-look badges (icons from Discord's own CDN); Discord Staff, Partner and Moderator Programs are left out
export const OFFICIAL: [key: string, name: string, icon: string][] = [
    ["nitro", "Nitro", "2ba85e8026a8614b640c2837bcdfe21b"],
    ["booster_1", "Server Booster (1 month)", "51040c70d4f20a921ad6674ff86fc95c"],
    ["booster_2", "Server Booster (2 months)", "0e4080d1d333bc7ad29ef6528b6f2fb7"],
    ["booster_3", "Server Booster (3 months)", "72bed924410c304dbe3d00a6e593ff59"],
    ["booster_4", "Server Booster (6 months)", "df199d2050d3ed4ebf84d64ae83989f8"],
    ["booster_5", "Server Booster (9 months)", "996b3e870e8a22ce519b3a50e6bdd52f"],
    ["booster_6", "Server Booster (1 year)", "991c9f39ee33d7537d9f408c3e53141e"],
    ["booster_7", "Server Booster (1 year 3 months)", "cb3ae83c15e970e8f3d410bc62cb8b99"],
    ["booster_8", "Server Booster (1 year 6 months)", "7142225d31238f6387d9f09efaa02759"],
    ["booster_9", "Server Booster (2 years)", "ec92202290b48d0879b7413d2dde3bab"],
    ["hypesquad", "HypeSquad Events", "bf01d1073931f921909045f3a39fd264"],
    ["bravery", "HypeSquad Bravery", "8a88d63823d8a71cd5e390baa45efa02"],
    ["brilliance", "HypeSquad Brilliance", "011940fd013da3f7fb926e4a1cd2e618"],
    ["balance", "HypeSquad Balance", "3aa41de486fa12454c3761e8e223442e"],
    ["bughunter", "Discord Bug Hunter", "2717692c7dca7289b35297368a940dd0"],
    ["bughunter_gold", "Discord Bug Hunter (gold)", "848f79194d4be5ff5f81505cbd0ce1e6"],
    ["early_supporter", "Early Supporter", "7060786766c9c840eb3019e725d2b358"],
    ["verified_developer", "Early Verified Bot Developer", "6df5892e0f35b051f8b61eace34f4967"],
    ["active_developer", "Active Developer", "6bdc42827a38498929a4920da12695d9"],
    ["legacy_username", "Originally known as their old username", "6de6d34650760ba5551a79732e98ed60"],
    ["quest", "Completed a Quest", "7d9ae358c8c5e118768335dbe68b4fb8"],
    ["supports_commands", "Supports Commands", "6f9e37f9029ff57aef81db857890005e"],
    ["automod", "Uses AutoMod", "f2459b691ac7453ed6039bbcfaccbfcd"],
];
const OFFICIAL_BY_KEY = new Map(OFFICIAL.map(o => [o[0], o]));
export const officialIcon = (hash: string) => `https://cdn.discordapp.com/badge-icons/${hash}.png`;

export interface CustomBadge { s: number; n: string; e: "none" | "glow" | "outline"; k: string; h: string; }
interface Entry { o?: 1; b?: string[]; c?: CustomBadge[]; }

let list: Record<string, Entry> = {};
let timer = 0;

/* ================= showing them ================= */

export const customImage = (hash: string) => `${BADGE_API}/img/${hash}.png`;

export function effectStyle(effect: string, color: string): React.CSSProperties {
    if (effect === "glow") return { filter: `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 1px ${color})` };
    if (effect === "outline") return { filter: `drop-shadow(1px 0 0 ${color}) drop-shadow(-1px 0 0 ${color}) drop-shadow(0 1px 0 ${color}) drop-shadow(0 -1px 0 ${color})` };
    return {};
}

// OG and uploaded badges first, before Discord's own
const frontBadges: ProfileBadge = {
    id: "terono-badges",
    position: BadgePosition.START,
    getBadges({ userId }) {
        const e = list[userId];
        if (!e) return [];
        const out: ProfileBadge[] = [];
        if (e.o) out.push({ id: "terono-og", description: "OG (Version 1.0.0 - 1.1.5)", iconSrc: OG_BADGE });
        for (const c of e.c ?? []) out.push({
            id: `terono-custom-${c.s}`,
            description: c.n,
            iconSrc: customImage(c.h),
            props: { style: effectStyle(c.e, c.k) },
        });
        return out;
    },
};

// official-look ones after Discord's own
const officialBadges: ProfileBadge = {
    id: "terono-official",
    position: BadgePosition.END,
    getBadges({ userId }) {
        return (list[userId]?.b ?? []).flatMap(key => {
            const o = OFFICIAL_BY_KEY.get(key);
            return o ? [{ id: `terono-official-${key}`, description: o[1], iconSrc: officialIcon(o[2]) }] : [];
        });
    },
};

// fresh = right after your own change (skips the 5 minute browser cache)
async function refresh(fresh = false) {
    if (!badgesReady()) return;
    try {
        const res = await fetch(`${BADGE_API}/badges`, { cache: fresh ? "no-cache" : "default" });
        if (!res.ok) return;
        const body = await res.json();
        if (body && typeof body.u === "object") {
            list = body.u;
            DataStore.set(CACHE_KEY, list);
        }
    } catch { /* offline: keep the last list */ }
}

// OG badge: every account that runs Terono 1.0.5 – 1.1.5 is added once
function inOgRange() {
    const [a, b, c] = VERSION.split(".").map(Number);
    const n = a * 1e6 + b * 1e3 + c;
    return n >= 1_000_005 && n <= 1_001_005;
}

async function hello() {
    const id = UserStore.getCurrentUser()?.id;
    if (!badgesReady() || !id || !inOgRange()) return;
    const done = await DataStore.get<string[]>(HELLO_KEY) ?? [];
    if (done.includes(id)) return;
    try {
        const res = await fetch(`${BADGE_API}/hello`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, v: VERSION }) });
        if (res.ok) await DataStore.set(HELLO_KEY, [...done, id]);
    } catch { /* next start */ }
}

const onConnect = () => void hello();

/* ---------- live: every change from everyone, as it happens ---------- */

let socket: WebSocket | null = null;
const liveListeners = new Set<(msg: any) => void>();
export const onLive = (fn: (msg: any) => void) => { liveListeners.add(fn); return () => void liveListeners.delete(fn); };
let retry = 0;
let retryTimer = 0;
let saveTimer = 0;
let pingTimer = 0;
let lastHeard = 0;
let running = false;

function connect() {
    if (!running || !badgesReady() || socket) return;
    const ws = socket = new WebSocket(`${BADGE_API.replace(/^http/, "ws")}/live`);
    ws.onopen = () => {
        // anything missed while disconnected
        if (retry) refresh(true);
        retry = 0;
        lastHeard = Date.now();
        sendPresence();
    };
    ws.onmessage = e => {
        lastHeard = Date.now();
        if (e.data === "pong") return;
        try {
            const msg = JSON.parse(e.data);
            // other kinds of live messages go to whoever listens for them
            if (msg.t) return liveListeners.forEach(l => l(msg));
            const { u, e: entry } = msg;
            if (typeof u !== "string") return;
            if (entry) list[u] = entry;
            else delete list[u];
            clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => DataStore.set(CACHE_KEY, list), 2000);
        } catch { /* not ours */ }
    };
    ws.onclose = () => {
        if (socket === ws) socket = null;
        if (!running) return;
        // 2s, 4s, 8s ... up to 5 minutes
        retry = Math.min(retry + 1, 8);
        clearTimeout(retryTimer);
        retryTimer = window.setTimeout(connect, Math.min(2 ** retry * 1000, 300_000));
    };
}

// "online now" for the Terono user count: tells the server this connection is a counted user (usage.tsx)
let present = false;
function sendPresence() {
    if (socket?.readyState === WebSocket.OPEN) socket.send(present ? `hi:${UserStore.getCurrentUser()?.id ?? ""}` : "bye");
}
export function setPresence(on: boolean) {
    present = on;
    sendPresence();
}

// a connection can die silently (sleep, network change): ping it, and start over when it stops answering
function keepAlive() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastHeard > 150_000) return socket.close();
    socket.send("ping");
}

const onOnline = () => {
    clearTimeout(retryTimer);
    connect();
};

export function startBadges() {
    running = true;
    addProfileBadge(frontBadges);
    addProfileBadge(officialBadges);
    // last list first (instant), then the current one, then live changes
    DataStore.get(CACHE_KEY).then(saved => { if (saved && !Object.keys(list).length) list = saved; });
    refresh(true).then(hello);
    connect();
    pingTimer = window.setInterval(keepAlive, 60_000);
    timer = window.setInterval(() => refresh(), REFRESH_MS);
    FluxDispatcher.subscribe("CONNECTION_OPEN", onConnect);
    window.addEventListener("online", onOnline);
}

export function stopBadges() {
    running = false;
    removeProfileBadge(frontBadges);
    removeProfileBadge(officialBadges);
    clearInterval(timer);
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    socket?.close();
    socket = null;
    FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnect);
    window.removeEventListener("online", onOnline);
}

/* ================= your own badges ================= */

interface Auth { token: string; id: string; }

export async function getAuth() {
    const auth = await DataStore.get<Record<string, string>>(AUTH_KEY);
    const id = UserStore.getCurrentUser()?.id;
    return id && auth?.[id] ? { token: auth[id], id } as Auth : null;
}

export function authorize() {
    return new Promise<boolean>(resolve => openModal(props => (
        <OAuth2AuthorizeModal
            {...props}
            scopes={["identify"]}
            responseType="code"
            redirectUri={`${BADGE_API}/authorize`}
            permissions={0n}
            clientId={BADGE_CLIENT_ID}
            cancelCompletesFlow={false}
            callback={async ({ location }: { location: string; }) => {
                try {
                    const res = await fetch(location);
                    const body = await res.json();
                    if (!res.ok || !body.token) throw new Error(body.error ?? res.statusText);
                    const all = await DataStore.get<Record<string, string>>(AUTH_KEY) ?? {};
                    await DataStore.set(AUTH_KEY, { ...all, [body.id]: body.token });
                    showToast("Connected. You can set your badges now.", Toasts.Type.SUCCESS);
                    resolve(true);
                } catch (e) {
                    showToast(`Couldn't connect: ${e instanceof Error ? e.message : e}`, Toasts.Type.FAILURE);
                    resolve(false);
                }
            }}
        />
    )));
}

async function disconnect() {
    const id = UserStore.getCurrentUser()?.id;
    const all = await DataStore.get<Record<string, string>>(AUTH_KEY) ?? {};
    if (id) delete all[id];
    await DataStore.set(AUTH_KEY, all);
}

export async function api(path: string, method = "GET", body?: unknown) {
    const auth = await getAuth();
    if (!auth) throw new Error("Not connected");
    const res = await fetch(`${BADGE_API}${path}`, {
        method,
        headers: { "Authorization": auth.token, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) await disconnect();
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
    return data;
}

// any picture -> 64x64 static PNG (GIFs keep their first frame), fitted inside and centered
async function toBadgePng(file: File) {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    const k = 64 / Math.max(bmp.width, bmp.height);
    const w = bmp.width * k, h = bmp.height * k;
    ctx.drawImage(bmp, (64 - w) / 2, (64 - h) / 2, w, h);
    bmp.close();
    const url = canvas.toDataURL("image/png");
    return { url, base64: url.slice(url.indexOf(",") + 1) };
}

interface Draft { name: string; effect: "none" | "glow" | "outline"; color: string; preview: string; image?: string; hash?: string; }
const EMPTY: Draft = { name: "", effect: "none", color: "#9b6dff", preview: "" };

function Slot({ index, saved, onSaved }: { index: number; saved?: CustomBadge; onSaved(): void; }) {
    const [d, setD] = useState<Draft>(() => saved ? { name: saved.n, effect: saved.e, color: saved.k, preview: customImage(saved.h), hash: saved.h } : EMPTY);
    const [busy, setBusy] = useState(false);
    const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }));

    async function pick(file?: File) {
        if (!file) return;
        if (!file.type.startsWith("image/")) return showToast("Pick an image file.", Toasts.Type.FAILURE);
        if (file.size > 20 * 1024 * 1024) return showToast("Image must be 20 MB or smaller.", Toasts.Type.FAILURE);
        try {
            const { url, base64 } = await toBadgePng(file);
            set({ preview: url, image: base64 });
        } catch {
            showToast("That image couldn't be read.", Toasts.Type.FAILURE);
        }
    }

    async function save() {
        if (!d.name.trim()) return showToast("Give the badge a name (shown when hovering it).", Toasts.Type.FAILURE);
        let { image } = d;
        if (!image && d.hash) {
            // only the name / effect / color changed: send the same picture again
            const blob = await (await fetch(customImage(d.hash))).blob();
            image = (await toBadgePng(new File([blob], "badge.png", { type: "image/png" }))).base64;
        }
        if (!image) return showToast("Choose an image first.", Toasts.Type.FAILURE);
        setBusy(true);
        try {
            const r = await api(`/me/badge/${index}`, "PUT", { name: d.name.trim(), effect: d.effect, color: d.color, image });
            set({ hash: r.hash, image: undefined });
            showToast("Badge saved. Everyone with Terono sees it right away.", Toasts.Type.SUCCESS);
            onSaved();
        } catch (e) {
            showToast(`Couldn't save: ${e instanceof Error ? e.message : e}`, Toasts.Type.FAILURE);
        }
        setBusy(false);
    }

    async function remove() {
        setBusy(true);
        try {
            if (d.hash) await api(`/me/badge/${index}`, "DELETE");
            setD(EMPTY);
            onSaved();
        } catch (e) {
            showToast(`Couldn't remove: ${e instanceof Error ? e.message : e}`, Toasts.Type.FAILURE);
        }
        setBusy(false);
    }

    return (
        <div className="dz-badge-slot">
            <label className="dz-badge-pic" title="Choose an image">
                {d.preview
                    ? <img src={d.preview} alt="" style={effectStyle(d.effect, d.color)} />
                    : <span>+</span>}
                <input type="file" accept="image/*" onChange={e => pick(e.currentTarget.files?.[0])} />
            </label>
            <div className="dz-badge-fields">
                <input className="dz-badge-name" placeholder={`Badge ${index + 1} name, shown on hover`} maxLength={40} value={d.name} onChange={e => set({ name: e.currentTarget.value })} />
                <div className="dz-badge-row">
                    <select value={d.effect} onChange={e => set({ effect: e.currentTarget.value as Draft["effect"] })}>
                        <option value="none">No effect</option>
                        <option value="glow">Glow</option>
                        <option value="outline">Outline</option>
                    </select>
                    {d.effect !== "none" && <input type="color" value={d.color} onChange={e => set({ color: e.currentTarget.value })} aria-label="Effect color" />}
                    <Button size="small" disabled={busy} onClick={save}>Save</Button>
                    {(d.preview || d.hash) && <Button size="small" variant="secondary" disabled={busy} onClick={remove}>Remove</Button>}
                </div>
            </div>
        </div>
    );
}

export function BadgesPanel() {
    const [auth, setAuth] = useState<Auth | null | undefined>(undefined);
    const [mine, setMine] = useState<{ og: boolean; official: string[]; custom: CustomBadge[]; } | null>(null);
    const [official, setOfficial] = useState<string[]>([]);
    const [rev, setRev] = useState(0);
    const me = UserStore.getCurrentUser();

    useEffect(() => { getAuth().then(setAuth); }, [rev]);
    useEffect(() => {
        if (!auth) return setMine(null);
        api("/me").then(m => { setMine(m); setOfficial(m.official); }).catch(() => getAuth().then(setAuth));
    }, [auth, rev]);

    if (!badgesReady()) return <p className="dz-badge-note">Badges aren't switched on in this build yet.</p>;

    const og = !!list[me?.id]?.o || !!mine?.og;
    const reload = () => { setRev(r => r + 1); refresh(true); };

    async function saveOfficial() {
        try {
            await api("/me/official", "PUT", { badges: official });
            showToast("Saved. Everyone with Terono sees them right away.", Toasts.Type.SUCCESS);
            reload();
        } catch (e) {
            showToast(`Couldn't save: ${e instanceof Error ? e.message : e}`, Toasts.Type.FAILURE);
        }
    }

    return (
        <div className="dz-badges">
            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Terono OG</h3>
                <div className="dz-badge-og">
                    <img src={OG_BADGE} alt="" />
                    <p>{og
                        ? "You have the Terono OG badge: everyone who uses Terono between 1.0.5 and 1.1.5 gets it, for good."
                        : "Everyone who uses Terono between 1.0.5 and 1.1.5 gets this badge. Yours is being added and shows up in a moment."}</p>
                </div>
            </section>

            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Your account</h3>
                {auth === undefined ? null : auth
                    ? <div className="dz-badge-auth"><span>Connected as <b>{me?.username}</b>. Your badges are shown to everyone who uses Terono.</span><Button size="small" variant="secondary" onClick={async () => { await disconnect(); reload(); }}>Disconnect</Button></div>
                    : <div className="dz-badge-auth"><span>To set your own badges, connect once. Discord asks you to <b>Authorize</b>: Terono only gets your user ID, nothing else.</span><Button size="small" onClick={async () => { if (await authorize()) reload(); }}>Connect with Discord</Button></div>}
            </section>

            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Custom badges ({MAX_CUSTOM} max)</h3>
                <p className="dz-badge-note">Any image; it's made 64×64 and still (GIFs keep their first frame). Optionally give it a glow or an outline in any color. Everyone with Terono sees them, so keep them friendly.</p>
                <div className={auth ? "" : "dz-badge-locked"}>
                    {[0, 1, 2].map(i => <Slot key={`${i}:${rev}:${mine ? 1 : 0}`} index={i} saved={mine?.custom.find(c => c.s === i)} onSaved={reload} />)}
                </div>
            </section>

            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Discord badges</h3>
                <p className="dz-badge-note">Wear Discord's badges; only people with Terono see them. Staff, Partner and Moderator badges aren't available.</p>
                <div className={`dz-badge-official${auth ? "" : " dz-badge-locked"}`}>
                    {OFFICIAL.map(([key, name, icon]) => {
                        const on = official.includes(key);
                        return (
                            <button key={key} className={`dz-badge-off${on ? " dz-badge-off-on" : ""}`} aria-pressed={on} title={name}
                                onClick={() => setOfficial(on ? official.filter(k => k !== key) : [...official, key])}>
                                <img src={officialIcon(icon)} alt="" />
                                <span>{name}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="dz-badge-save"><Button size="small" disabled={!auth} onClick={saveOfficial}>Save Discord badges</Button></div>
            </section>
        </div>
    );
}

export const BADGES_CSS = `
.dz-badges { display: flex; flex-direction: column; gap: 14px; }
.dz-badge-note { margin: 4px 0 10px; font-size: 13px; line-height: 1.4; color: var(--text-muted, #aaa); }
.dz-badge-og { display: flex; align-items: center; gap: 14px; padding: 6px 0 10px; }
.dz-badge-og img { width: 48px; height: 48px; flex-shrink: 0; }
.dz-badge-og p { margin: 0; color: var(--text-default, #fff); line-height: 1.4; }
.dz-badge-auth { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0 10px; color: var(--text-default, #fff); font-size: 14px; line-height: 1.4; }
.dz-badge-auth > button { flex-shrink: 0; }
.dz-badge-locked { opacity: .45; pointer-events: none; }
.dz-badge-slot { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.dz-badge-slot + .dz-badge-slot { border-top: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-badge-pic { position: relative; display: grid; place-items: center; width: 56px; height: 56px; flex-shrink: 0; border-radius: 12px; cursor: pointer;
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); border: 1px dashed color-mix(in srgb, var(--dz-text, #f1f2f4) 25%, transparent); }
.dz-badge-pic:hover { border-color: var(--dz-accent, #429cff); }
.dz-badge-pic img { width: 40px; height: 40px; }
.dz-badge-pic span { font-size: 26px; color: var(--text-muted, #aaa); }
.dz-badge-pic input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.dz-badge-fields { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dz-badge-name, .dz-badge-row select { box-sizing: border-box; height: 34px; padding: 0 10px; border-radius: 8px; font: 500 14px var(--font-primary, "gg sans", sans-serif);
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 10%, transparent); outline: none; }
.dz-badge-name { width: 100%; }
.dz-badge-name:focus, .dz-badge-row select:focus { border-color: var(--dz-accent, #429cff); }
.dz-badge-row select option { background: var(--dz-card, #070708); }
.dz-badge-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dz-badge-row input[type=color] { width: 34px; height: 30px; padding: 0; border: none; background: none; cursor: pointer; }
.dz-badge-official { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; }
.dz-badge-off { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; cursor: pointer; text-align: left; font: 500 12px var(--font-primary, "gg sans", sans-serif);
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 4%, transparent); border: 1px solid transparent; transition: border-color 120ms ease, background 120ms ease; }
.dz-badge-off img { width: 22px; height: 22px; flex-shrink: 0; }
.dz-badge-off-on { border-color: var(--dz-accent, #429cff); background: color-mix(in srgb, var(--dz-accent, #429cff) 14%, transparent); }
.dz-badge-save { display: flex; justify-content: flex-end; padding: 10px 0 6px; }`;
