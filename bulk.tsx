/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addGlobalContextMenuPatch, GlobalContextMenuPatchCallback, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { findByPropsLazy } from "@webpack";
import { ActiveJoinedThreadsStore, Alerts, ChannelStore, createRoot, FluxDispatcher, GuildChannelStore, GuildStore, Menu, React, ReactDOM, ReadStateStore, RelationshipStore, UserStore } from "@webpack/common";

import { settings } from "./settings";
import { toast } from "./toast";

/* ================= bulk mode =================
   Hold Ctrl and click servers (server list), DMs (DM list) or friends (friends page) to select several. Then
   right-click any of the selected ones: it's Discord's own menu for it, with everything in it, and what you pick
   is done to all of them (one after another, with a short pause, so Discord doesn't see a burst).
   How: Discord's menu for each of the other selected ones is rendered off screen, and the item with the same id is
   run there, so every option (including other plugins' ones) works exactly like it does by hand.
   Leave, remove friend and block ask once for all of them. Double-clicking Home marks everything read. */

const GuildActions = findByPropsLazy("leaveGuild");
const RelationshipActions = findByPropsLazy("removeFriend");

type Kind = "guild" | "dm" | "friend";
let kind: Kind | null = null;
const selected = new Set<string>();
let bar: HTMLDivElement | null = null;
let style: HTMLStyleElement | null = null;
let busy = false;

function itemOf(target: EventTarget | null): { kind: Kind; id: string; } | null {
    const el = (target as Element | null)?.closest?.<HTMLElement>("[data-list-item-id]");
    const id = el?.dataset.listItemId ?? "";
    let m = id.match(/^guildsnav___(\d{17,20})$/);
    if (m && GuildStore.getGuild(m[1])) return { kind: "guild", id: m[1] };
    m = id.match(/^private-channels-uid_\d+___(\d{17,20})$/);
    if (m && ChannelStore.getChannel(m[1])) return { kind: "dm", id: m[1] };
    m = id.match(/^people___(\d{17,20})$/);
    if (m) return { kind: "friend", id: m[1] };
    return null;
}

// the selection is shown with CSS only: nothing watches the page, so lists scroll and re-render as fast as always
function mark() {
    const sel = [...selected].map(id =>
        kind === "guild" ? `[data-list-item-id="guildsnav___${id}"]`
            : kind === "dm" ? `[data-list-item-id^="private-channels-uid_"][data-list-item-id$="___${id}"]`
                : `[data-list-item-id="people___${id}"]`);
    if (!sel.length) { style?.remove(); style = null; return; }
    style ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: "terono-bulk-picked" }));
    style.textContent = `:is(${sel.join(",")}) { outline: 2px solid var(--dz-accent, #429cff) !important; outline-offset: -2px; border-radius: var(--radius-md, 12px); background: color-mix(in srgb, var(--dz-accent, #429cff) 14%, transparent); }`;
}

function clear() {
    selected.clear();
    kind = null;
    mark();
    renderBar();
}

const NAMES: Record<Kind, [string, string]> = { guild: ["server", "servers"], dm: ["DM", "DMs"], friend: ["friend", "friends"] };
const count = (n: number, k: Kind) => `${n} ${NAMES[k][n === 1 ? 0 : 1]}`;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ---------- read everything ---------- */

function ackChannels(channelIds: string[]) {
    const channels = channelIds.filter(id => ReadStateStore.hasUnread(id)).map(channelId => ({ channelId, messageId: ReadStateStore.lastMessageId(channelId), readStateType: 0 }));
    if (channels.length) FluxDispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels });
}

function guildChannelIds(guildId: string) {
    const c = GuildChannelStore.getChannels(guildId);
    return [
        ...c.SELECTABLE.map((x: any) => x.channel.id),
        ...c.VOCAL.map((x: any) => x.channel.id),
        ...Object.values(ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guildId)).flatMap((t: any) => Object.values(t).map((x: any) => x.channel?.id ?? x.id)),
    ].filter(Boolean);
}

export function markEverythingRead() {
    ackChannels([
        ...Object.keys(GuildStore.getGuilds()).flatMap(guildChannelIds),
        ...ChannelStore.getSortedPrivateChannels().map(c => c.id),
    ]);
    toast("Everything marked as read.", "success");
}

/* ---------- Discord's own menu, for all of them ---------- */

const MENUS = new Set(["guild-context", "user-context", "gdm-context"]);
// what a menu is about
const targetOf = (k: Kind, props: any): string | undefined => k === "guild" ? props?.guild?.id : k === "dm" ? props?.channel?.id : props?.user?.id;
// ids like "devmode-copy-id-<id>" contain the target: compare without it
const norm = (id: string) => id.replace(/\d{17,20}/g, "#");
// only make sense once (copying, opening something for one of them)
const ONCE = /copy|profile|message|call|note|invite|settings|mention|report|apps|nickname/i;

let capture: ((navId: string, children: any[]) => void) | null = null;

function findItem(children: any, id: string): any {
    for (const c of [children].flat(Infinity) as any[]) {
        if (!c?.props) continue;
        if (c.props.id && norm(c.props.id) === id) return c;
        const inner = c.props.children && findItem(c.props.children, id);
        if (inner) return inner;
    }
    return null;
}

// the component that drew the open menu, and its props (from the menu on screen)
function openMenuSource(navId: string, k: Kind) {
    const el = document.getElementById(navId) ?? [...document.querySelectorAll("[role=menu]")].pop();
    const key = el && Object.keys(el).find(k => k.startsWith("__reactFiber"));
    let f = key ? (el as any)[key] : null, comp: any = null, props: any = null;
    for (let i = 0; f && i < 24; i++, f = f.return) {
        if (typeof f.type === "function" && targetOf(k, f.memoizedProps)) { comp = f.type; props = f.memoizedProps; }
    }
    return comp ? { comp, props } : null;
}

function propsFor(k: Kind, base: any, id: string) {
    if (k === "guild") { const guild = GuildStore.getGuild(id); return guild && { ...base, guild }; }
    if (k === "friend") { const user = UserStore.getUser(id); return user && { ...base, user }; }
    const channel = ChannelStore.getChannel(id);
    if (!channel) return null;
    const user = channel.recipients?.length === 1 ? UserStore.getUser(channel.recipients[0]) : undefined;
    // a group DM has its own menu: only mix like with like
    if (!!base.user !== !!user) return null;
    return { ...base, channel, ...(user ? { user } : {}) };
}

// Discord's menu for another one of them, drawn off screen just to read its items
function itemsFor(comp: any, props: any, navId: string): any[] | null {
    let items: any[] | null = null;
    capture = (nav, children) => { if (nav === navId) items = children; };
    const root = createRoot(document.createElement("div"));
    try {
        ReactDOM.flushSync(() => root.render(React.createElement(comp, { ...props, onSelect: () => { }, onClose: () => { } })));
    } catch { /* that one can't be drawn */ } finally {
        capture = null;
        try { root.unmount(); } catch { }
    }
    return items;
}

const dialogs = () => document.querySelectorAll("[role=dialog]").length;

async function runForAll(navId: string, k: Kind, anchor: string, item: any, original: () => void) {
    const id = norm(item.props.id);
    const before = item.props.checked;
    const src = openMenuSource(navId, k);
    const open = dialogs();
    original();
    if (!src || ONCE.test(id)) return;
    await pause(60);
    // it opened a window for this one (a form, a picker): that's not something to repeat
    if (dialogs() > open) return;

    const others = [...selected].filter(x => x !== anchor);
    busy = true;
    renderBar();
    let done = 1;
    for (const other of others) {
        const props = propsFor(k, src.props, other);
        const items = props && itemsFor(src.comp, props, navId);
        const it = items && findItem(items, id);
        // a checkbox: only flip the ones that were like this one, so all end up the same
        if (it?.props.action && (before === undefined || it.props.checked === before)) {
            try { await it.props.action(); done++; } catch { }
            await pause(350);
        } else if (it && before !== undefined && it.props.checked !== before) done++;
    }
    busy = false;
    toast(`${item.props.label ?? "Done"}: ${done} of ${others.length + 1} ${NAMES[k][1]}.`, done === others.length + 1 ? "success" : "message");
    renderBar();
}

// leaving, removing and blocking ask once for all of them instead of once each
function confirmAll(title: string, k: Kind, what: string, run: (id: string) => unknown, ids: string[]) {
    const names = ids.map(id => k === "guild" ? GuildStore.getGuild(id)?.name : UserStore.getUser(id)?.username).filter(Boolean);
    Alerts.show({
        title: `${title} ${count(ids.length, k)}?`,
        body: names.join(", "),
        confirmText: what,
        cancelText: "Cancel",
        confirmColor: "vc-red",
        onConfirm: async () => {
            busy = true;
            renderBar();
            let done = 0;
            for (const id of ids) {
                try { await run(id); done++; } catch { }
                await pause(1200);
            }
            busy = false;
            toast(`${what}: ${done} of ${ids.length} done.`, done === ids.length ? "success" : "failure");
            clear();
        },
    });
}

function special(id: string, k: Kind): (() => void) | null {
    const ids = [...selected];
    const users = k === "friend" ? ids : ids.map(c => ChannelStore.getChannel(c)?.recipients?.length === 1 ? ChannelStore.getChannel(c)!.recipients[0] : "").filter(Boolean);
    if (id === "leave-guild" && k === "guild") return () => confirmAll("Leave", k, "Leave", g => GuildActions.leaveGuild(g), ids);
    if (id === "remove-friend") return () => confirmAll("Remove", "friend", "Remove", u => RelationshipActions.removeFriend(u, { location: "ContextMenu" }), users.filter(u => RelationshipStore.isFriend(u)));
    if (id === "block") return () => confirmAll("Block", "friend", "Block", u => RelationshipActions.addRelationship({ userId: u, context: { location: "ContextMenu" }, type: 2 }), users);
    return null;
}

function wrap(node: any, navId: string, k: Kind, anchor: string): any {
    if (Array.isArray(node)) return node.map(n => wrap(n, navId, k, anchor));
    if (!node?.props) return node;
    let { props } = node;
    if (props.children && typeof props.children !== "string") props = { ...props, children: wrap(props.children, navId, k, anchor) };
    if (props.id && typeof props.action === "function") {
        const original = props.action;
        const own = special(norm(props.id), k);
        props = { ...props, action: own ?? (() => runForAll(navId, k, anchor, node, original)) };
    }
    return props === node.props ? node : React.cloneElement(node, props);
}

const menuPatch: GlobalContextMenuPatchCallback = (navId, children, ...args) => {
    if (capture) return capture(navId, children);
    if (!kind || selected.size < 2 || !MENUS.has(navId) || busy) return;
    const anchor = targetOf(kind, args[0]);
    if (!anchor || !selected.has(anchor)) return;
    const wrapped = wrap(children, navId, kind, anchor);
    children.splice(0, children.length,
        <Menu.MenuGroup key="dz-bulk-head">
            <Menu.MenuItem id="dz-bulk-head" label={`For all ${count(selected.size, kind)}`} disabled action={() => { }} />
        </Menu.MenuGroup>,
        ...wrapped
    );
};

/* ---------- the bar ---------- */

function renderBar() {
    if (!selected.size || !kind) {
        bar?.remove();
        bar = null;
        return;
    }
    if (!bar) {
        bar = document.createElement("div");
        bar.className = "dz-bulk";
        document.body.append(bar);
    }
    const label = document.createElement("span");
    label.className = "dz-bulk-count";
    label.textContent = busy ? "Working…" : count(selected.size, kind) + " selected";
    const hint = document.createElement("span");
    hint.className = "dz-bulk-hint";
    hint.textContent = busy ? "" : selected.size > 1 ? "Right-click one of them for everything you can do to all" : "Ctrl + click more";
    const x = document.createElement("button");
    x.className = "dz-bulk-x";
    x.textContent = "✕";
    x.title = "Clear selection (Esc)";
    x.disabled = busy;
    x.onclick = clear;
    bar.replaceChildren(label, hint, x);
}

/* ---------- input ---------- */

function onClick(e: MouseEvent) {
    if (!settings.store.bulkMode || !e.ctrlKey || e.shiftKey || e.altKey || busy) return;
    const it = itemOf(e.target);
    if (!it) return;
    e.preventDefault();
    e.stopPropagation();
    if (kind !== it.kind) {
        selected.clear();
        kind = it.kind;
    }
    if (selected.has(it.id)) selected.delete(it.id);
    else selected.add(it.id);
    if (!selected.size) kind = null;
    mark();
    renderBar();
}

function onDoubleClick(e: MouseEvent) {
    if (!settings.store.homeDoubleClick) return;
    if ((e.target as Element | null)?.closest?.('[data-list-item-id="guildsnav___home"]')) markEverythingRead();
}

function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && selected.size && !busy && !document.querySelector("[role=menu]")) clear();
}

export function startBulk() {
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("keydown", onKey);
    addGlobalContextMenuPatch(menuPatch);
}

export function stopBulk() {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDoubleClick, true);
    document.removeEventListener("keydown", onKey);
    removeGlobalContextMenuPatch(menuPatch);
    clear();
}

export const BULK_CSS = `
.dz-bulk { position: fixed; left: 50%; bottom: 22px; z-index: 10000; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px;
    border-radius: 16px; color: var(--dz-text, #f1f2f4); font: 500 14px var(--font, "gg sans"), sans-serif;
    background: color-mix(in srgb, var(--dz-card, #070708) 94%, transparent); border: 1px solid color-mix(in srgb, var(--dz-accent, #429cff) 45%, transparent);
    box-shadow: 0 14px 40px rgb(0 0 0 / 45%); animation: dz-bulk-in 180ms ease-out both; pointer-events: auto; }
.dz-bulk-count { font-weight: 700; white-space: nowrap; }
.dz-bulk-hint { opacity: .7; font-size: 13px; white-space: nowrap; }
.dz-bulk-x { width: 30px; height: 30px; border-radius: 10px; cursor: pointer; color: var(--dz-text, #f1f2f4); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-bulk-x:hover:not(:disabled) { background: color-mix(in srgb, var(--dz-accent, #429cff) 30%, transparent); }
@keyframes dz-bulk-in { from { opacity: 0; transform: translate(-50%, 10px); } }`;
