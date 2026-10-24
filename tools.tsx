/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { copyToClipboard } from "@utils/clipboard";
import { openUserProfile } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, Modal, NavigationRouter, openModal, RelationshipStore, RestAPI, SelectedChannelStore, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { settings } from "./settings";
import { toast } from "./toast";

/* ================= small tools =================
   - Search tools: a button next to the chat search opens every picture and video of the chat as a grid, every link
     (and a search *inside* the links: "kori" finds coolify.kori.my, which Discord's search doesn't), or every file.
     It uses Discord's own search, page by page, gently paced.
   - A "Blocked" button next to "Add Friend" with everyone you've blocked or ignored, since Discord moved that list
     deep into the settings.
   The buttons are put in place by one cheap check a second, and only on the pages that have them. */

const RelationshipActions = findByPropsLazy("unblockUser", "removeFriend");

/* ================= search tools ================= */

type Mode = "media" | "links" | "files";
interface Hit { key: string; msg: string; channel: string; guild?: string; author: string; time: string; url: string; thumb?: string; video?: boolean; name?: string; size?: number; host?: string; }

const PAGE = 25;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const URL_IN_TEXT = /https?:\/\/[^\s<>()"']+/g;

function searchBase(channelId: string, wholeServer: boolean) {
    const c = ChannelStore.getChannel(channelId);
    if (c?.guild_id) return { url: `/guilds/${c.guild_id}/messages/search`, query: wholeServer ? {} : { channel_id: channelId }, guild: c.guild_id };
    return { url: `/channels/${channelId}/messages/search`, query: {}, guild: undefined };
}

// one page of Discord's search; waits and retries while the index is warming up or on a rate limit
async function searchPage(url: string, query: Record<string, unknown>, offset: number): Promise<{ total: number; messages: any[]; }> {
    for (let tries = 0; tries < 6; tries++) {
        try {
            const r: any = await RestAPI.get({ url, query: { ...query, offset, include_nsfw: true }, retries: 1 } as any);
            if (r.status === 202) { await sleep((r.body?.retry_after ?? 2) * 1000); continue; }
            return { total: r.body.total_results ?? 0, messages: (r.body.messages ?? []).map((m: any[]) => m[0]).filter(Boolean) };
        } catch (e: any) {
            if (e?.status === 429) { await sleep(((e.body?.retry_after ?? 2) * 1000) + 250); continue; }
            throw e;
        }
    }
    throw new Error("Discord's search is busy, try again in a moment");
}

function hitsOf(m: any, mode: Mode, guild?: string): Hit[] {
    const base = { msg: m.id, channel: m.channel_id, guild, author: m.author?.global_name || m.author?.username || "", time: m.timestamp };
    const out: Hit[] = [];
    if (mode === "media") {
        for (const a of m.attachments ?? []) {
            const ct = a.content_type ?? "";
            if (ct.startsWith("image/") || ct.startsWith("video/")) out.push({ ...base, key: a.id, url: a.url, thumb: ct.startsWith("video/") ? a.proxy_url : `${a.proxy_url}${a.proxy_url.includes("?") ? "&" : "?"}width=240&height=240`, video: ct.startsWith("video/"), name: a.filename });
        }
        for (const [i, e] of (m.embeds ?? []).entries()) {
            const img = e.image ?? e.thumbnail;
            if (e.video?.proxy_url || (e.type === "gifv" && e.video)) out.push({ ...base, key: `${m.id}-e${i}`, url: e.url ?? e.video.url, thumb: img?.proxy_url, video: !img, name: e.title ?? "" });
            else if (img?.proxy_url && (e.type === "image" || e.type === "gifv")) out.push({ ...base, key: `${m.id}-e${i}`, url: e.url ?? img.url, thumb: img.proxy_url, name: e.title ?? "" });
        }
    } else if (mode === "files") {
        for (const a of m.attachments ?? []) if (!/^(image|video)\//.test(a.content_type ?? "")) out.push({ ...base, key: a.id, url: a.url, name: a.filename, size: a.size });
    } else {
        const urls = new Set<string>([...(m.content?.match(URL_IN_TEXT) ?? []), ...(m.embeds ?? []).map((e: any) => e.url).filter(Boolean)]);
        for (const u of urls) {
            let host = "";
            try { host = new URL(u).host; } catch { continue; }
            out.push({ ...base, key: `${m.id}-${u}`, url: u.replace(/[.,;:!?]+$/, ""), host });
        }
    }
    return out;
}

const HAS: Record<Mode, string[]> = { media: ["image", "video"], links: ["link"], files: ["file"] };

function SearchTools({ channelId, initial, close }: { channelId: string; initial: Mode; close(): void; }) {
    const c = ChannelStore.getChannel(channelId);
    const [mode, setMode] = useState<Mode>(initial);
    const [whole, setWhole] = useState(false);
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<Hit[]>([]);
    const [state, setState] = useState({ loading: false, done: false, seen: 0, total: 0, error: "" });
    const run = useRef(0);

    // a keyword for links / files is matched inside the URL / file name, so the whole chat is read for it
    async function load(reset: boolean) {
        const id = reset ? ++run.current : run.current;
        const { url, query, guild } = searchBase(channelId, whole);
        let offset = reset ? 0 : state.seen;
        if (reset) setHits([]);
        setState(s => ({ ...s, loading: true, error: "", done: false, ...(reset ? { seen: 0, total: 0 } : {}) }));
        const w = q.trim().toLowerCase();
        let found = 0;
        try {
            // without a keyword one page at a time ("Load more"); with one, keep reading until something is found or it ends
            for (let pages = 0; pages < (w ? 40 : 2); pages++) {
                const { total, messages } = await searchPage(url, { ...query, has: HAS[mode] }, offset);
                if (id !== run.current) return;
                offset += messages.length;
                const add = messages.flatMap(m => hitsOf(m, mode, guild)).filter(h => !w || `${h.url} ${h.name ?? ""}`.toLowerCase().includes(w));
                found += add.length;
                setHits(h => { const keys = new Set(h.map(x => x.key)); return [...h, ...add.filter(x => !keys.has(x.key))]; });
                const done = !messages.length || offset >= total || offset >= 9975;
                setState(s => ({ ...s, seen: offset, total, done }));
                if (done || (!w && pages >= 0 && found >= PAGE) || (w && found >= 60)) break;
                await sleep(400);
            }
        } catch (e: any) {
            if (id === run.current) setState(s => ({ ...s, error: e?.body?.message ?? e?.message ?? String(e) }));
        }
        if (id === run.current) setState(s => ({ ...s, loading: false }));
    }

    useEffect(() => { load(true); }, [mode, whole]);

    const jump = (h: Hit) => { close(); NavigationRouter.transitionTo(`/channels/${h.guild ?? "@me"}/${h.channel}/${h.msg}`); };
    const when = (t: string) => new Date(t).toLocaleDateString();

    return (
        <div className="dz-st">
            <div className="dz-st-bar">
                {(["media", "links", "files"] as Mode[]).map(m => (
                    <button key={m} className={`dz-chip ${mode === m ? "dz-on" : ""}`} onClick={() => setMode(m)}>{m === "media" ? "Pictures & videos" : m === "links" ? "Links" : "Files"}</button>
                ))}
                <span className="dz-grow" />
                {c?.guild_id && (
                    <select className="dz-input" value={whole ? "server" : "channel"} onChange={e => setWhole(e.currentTarget.value === "server")} aria-label="Where">
                        <option value="channel">This channel</option>
                        <option value="server">Whole server</option>
                    </select>
                )}
            </div>
            <div className="dz-st-bar">
                <input className="dz-input dz-grow" placeholder={mode === "links" ? "Search inside links, e.g. kori (finds coolify.kori.my)" : mode === "files" ? "Search file names" : "Search file names or links"}
                    value={q} onChange={e => setQ(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") load(true); }} />
                <Button size="small" onClick={() => load(true)}>Search</Button>
            </div>

            {mode === "media"
                ? <div className="dz-st-grid">{hits.map(h => (
                    <button key={h.key} className="dz-st-media" title={`${h.author} · ${when(h.time)}${h.name ? ` · ${h.name}` : ""}`} onClick={() => jump(h)}>
                        {h.video && !h.thumb?.match(/\.(png|jpe?g|webp|gif)/i) ? <video src={h.thumb ?? h.url} muted preload="metadata" /> : <img src={h.thumb} alt="" loading="lazy" />}
                        {h.video && <span className="dz-st-play">▶</span>}
                    </button>
                ))}</div>
                : <div className="dz-st-list">{hits.map(h => (
                    <div key={h.key} className="dz-st-row">
                        <div className="dz-st-text" onClick={() => jump(h)} role="button" tabIndex={0}>
                            <b>{mode === "links" ? h.host : h.name}</b>
                            <span>{mode === "links" ? h.url : `${((h.size ?? 0) / 1024 / 1024).toFixed(2)} MB`}</span>
                            <small>{h.author} · {when(h.time)}</small>
                        </div>
                        <Button size="small" variant="secondary" onClick={() => { copyToClipboard(h.url); toast("Copied.", "success"); }}>Copy</Button>
                        <Button size="small" variant="secondary" onClick={() => VencordNative.native.openExternal(h.url)}>Open</Button>
                    </div>
                ))}</div>}

            <div className="dz-st-foot">
                <span>{state.error ? `Couldn't search: ${state.error}` : state.loading ? `Reading messages… ${state.seen}${state.total ? ` of ${state.total}` : ""}` : `${hits.length} found${state.total ? ` in ${state.seen} of ${state.total} messages` : ""}`}</span>
                {!state.done && !state.loading && !state.error && <Button size="small" variant="secondary" onClick={() => load(false)}>Load more</Button>}
            </div>
        </div>
    );
}

export function openSearchTools(mode: Mode = "media") {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return toast("Open a chat first.", "message");
    openModal(props => (
        <Modal {...props} title="Search this chat" size="lg">
            <SearchTools channelId={channelId} initial={mode} close={props.onClose} />
        </Modal>
    ));
}

/* ================= blocked people ================= */

function BlockedList() {
    const [, rerender] = useState(0);
    const ids = [...new Set([...(RelationshipStore as any).getBlockedIDs(), ...(RelationshipStore as any).getIgnoredIDs()])] as string[];
    if (!ids.length) return <p className="dz-look-note">You haven't blocked or ignored anyone.</p>;
    return (
        <div className="dz-st-list">
            {ids.map(id => {
                const u = UserStore.getUser(id);
                const blocked = RelationshipStore.isBlocked(id);
                return (
                    <div key={id} className="dz-st-row">
                        {u && <img className="dz-blocked-av" src={u.getAvatarURL(undefined, 40)} alt="" />}
                        <div className="dz-st-text" onClick={() => openUserProfile(id)} role="button" tabIndex={0}>
                            <b>{u?.globalName || u?.username || id}</b>
                            <small>{blocked ? "Blocked" : "Ignored"}{u ? ` · ${u.username}` : ""}</small>
                        </div>
                        <Button size="small" variant="secondary" onClick={async () => {
                            try {
                                if (blocked) await RelationshipActions.unblockUser(id, { location: "ContextMenu" });
                                else await RelationshipActions.unignoreUser(id, "ContextMenu");
                                rerender(x => x + 1);
                            } catch { toast("Couldn't do that, try again.", "failure"); }
                        }}>{blocked ? "Unblock" : "Unignore"}</Button>
                    </div>
                );
            })}
        </div>
    );
}

export function openBlocked() {
    openModal(props => (
        <Modal {...props} title="Blocked & ignored" size="md">
            <BlockedList />
        </Modal>
    ));
}

/* ================= putting the buttons in ================= */

const SEARCH_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm2 0v7.6l3.3-3.3a1 1 0 0 1 1.4 0l2.3 2.3 1.3-1.3a1 1 0 0 1 1.4 0L18 12.6V5H6Zm9 3.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9 19h6a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Z"/></svg>';

function ensureButtons() {
    if (document.hidden) return;
    const s = settings.store;
    // chat header: next to the search bar
    const search = s.searchTools ? document.querySelector<HTMLElement>('[class*="toolbar_"] > [class*="search_"]') : null;
    const have = document.querySelector(".dz-st-btn");
    if (search && (!have || have.nextElementSibling !== search)) {
        have?.remove();
        const sample = search.parentElement?.querySelector<HTMLElement>('[class*="iconWrapper_"]');
        const b = document.createElement("div");
        b.className = `${sample?.className ?? ""} dz-st-btn`;
        b.setAttribute("role", "button");
        b.setAttribute("aria-label", "Pictures, links and files");
        b.tabIndex = 0;
        b.title = "Pictures, links and files in this chat";
        b.innerHTML = SEARCH_ICON;
        b.onclick = () => openSearchTools();
        b.onkeydown = e => { if (e.key === "Enter") openSearchTools(); };
        search.before(b);
    } else if (!search) have?.remove();

    // friends page: after "Add Friend"
    const add = s.blockedButton ? document.querySelector<HTMLElement>(".tabBar__133bf .addFriend__133bf") : null;
    const blocked = document.querySelector(".dz-blocked-btn");
    if (add && !blocked) {
        const sample = add.parentElement?.querySelector<HTMLElement>(".item__133bf:not(.addFriend__133bf)");
        const b = document.createElement("div");
        b.className = `${sample?.className.replace(/\bselected\S*/g, "") ?? ""} dz-blocked-btn`;
        b.setAttribute("role", "button");
        b.tabIndex = 0;
        b.textContent = "Blocked";
        b.onclick = openBlocked;
        add.after(b);
    } else if (!add) blocked?.remove();
}

let timer = 0;

export function startTools() {
    timer = window.setInterval(ensureButtons, 1000);
}

export function stopTools() {
    clearInterval(timer);
    document.querySelectorAll(".dz-st-btn, .dz-blocked-btn").forEach(e => e.remove());
}

export const TOOLS_CSS = `
.dz-st { display: flex; flex-direction: column; gap: 10px; padding-bottom: 14px; }
.dz-st-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dz-st-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 6px; max-height: 58vh; overflow-y: auto; }
.dz-st-media { position: relative; aspect-ratio: 1; padding: 0; border: 0; border-radius: 10px; overflow: hidden; cursor: pointer; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-st-media img, .dz-st-media video { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .15s ease; }
.dz-st-media:hover img, .dz-st-media:hover video { transform: scale(1.04); }
.dz-st-play { position: absolute; inset: auto 6px 6px auto; padding: 2px 6px; border-radius: 6px; font-size: 11px; color: #fff; background: rgb(0 0 0 / 60%); }
.dz-st-list { display: flex; flex-direction: column; max-height: 58vh; overflow-y: auto; }
.dz-st-row { display: flex; align-items: center; gap: 8px; padding: 8px 4px; border-top: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-st-row:first-child { border-top: none; }
.dz-st-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; cursor: pointer; color: var(--text-default, #fff); }
.dz-st-text span { font-size: 12px; color: var(--dz-accent, #429cff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-st-text small { font-size: 11px; color: var(--text-muted, #aaa); }
.dz-st-text:hover b { text-decoration: underline; }
.dz-st-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-muted, #aaa); }
.dz-blocked-av { width: 32px; height: 32px; border-radius: 50%; }
.dz-st-btn svg { display: block; }
`;
