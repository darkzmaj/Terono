/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import { findLazy } from "@webpack";
import { Menu, Modal, openModal, RestAPI, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { BADGE_API, badgesReady } from "./badgeConfig";
import { api, authorize, getAuth, looks, onListChange, refreshBadges } from "./badges";
import { settings } from "./settings";
import { toast } from "./toast";

/* ================= profile looks =================
   Discord's Nitro profile items, for everyone with Terono: a font, effect and colors for your name (Discord's own
   name styles), an avatar decoration, a nameplate, a profile effect and frame, profile card colors and a banner.
   Your look is kept on the Terono server (badges.tsx downloads everyone's along with the badges); only people with
   Terono see it. Nothing is drawn by Terono itself: the items are put on Discord's own user and profile data, so
   Discord shows them exactly where and how it shows the real ones (chat, member list, profiles, voice).
   "People" are your own name styles for other users (a font and color for a friend's name): only you see those. */

export interface Look {
    f?: number; x?: number; c?: number[]; // name: font, effect, colors
    d?: { a: string; s: string; }; // avatar decoration: asset, sku
    n?: { a: string; s: string; p: string; t: string; }; // nameplate: asset, sku, palette, label
    e?: string; r?: string; // profile effect sku, profile frame sku
    t?: [number, number]; // profile card colors
    b?: string; // banner hash on the Terono server
}

/* ---------- Discord's name fonts and effects ---------- */

const FontIds = findLazy(m => m?.ORBITRON !== undefined && m?.HEXAGON !== undefined && m?.DEFAULT !== undefined) as Record<string, number | string>;
// Discord's own font id -> class lookup (fonts Discord retired have no class and aren't offered)
const FontInfo = findLazy(m => typeof m?.p === "function" && String(m?.a).includes("useDisplayNameStylesFont")) as { p(id: number): { className: string; }; };
const FontClasses = findLazy(m => typeof m === "object" && m !== null && Object.values(m).some(v => typeof v === "string" && v.startsWith("dnsFont__"))) as Record<string, string>;

export const NAME_EFFECTS: [number, string][] = [[1, "Solid"], [2, "Gradient"], [3, "Neon"], [4, "Toon"], [5, "Pop"], [6, "Glow"], [7, "Prism"], [8, "Gummy"]];

const title = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

// [id, name, class] for every font Discord still draws, "Default" first
export function nameFonts(): [number, string, string][] {
    try {
        const base = Object.values(FontClasses).find(c => c.startsWith("dnsFont__")) ?? "";
        return Object.entries(FontIds)
            .filter(([k, v]) => typeof v === "number" && !/^\d+$/.test(k))
            .map(([k, v]) => [v as number, title(k), k === "DEFAULT" ? "" : FontInfo.p(v as number)?.className ?? ""] as [number, string, string])
            .filter(([, name, cls]) => name === "Default" || cls)
            .map(([id, name, cls]) => [id, name, cls ? `${base} ${cls}` : ""] as [number, string, string])
            .sort((a, b) => (a[1] === "Default" ? -1 : b[1] === "Default" ? 1 : a[1].localeCompare(b[1])));
    } catch {
        return [];
    }
}

/* ---------- whose look is what ---------- */

let mine: Look | null = null; // your own, as being edited (shown to you right away, before saving)

function people(): Record<string, Look> {
    try { return JSON.parse(settings.store.peopleLooks || "{}"); } catch { return {}; }
}

export function setPerson(id: string, look: Look | null) {
    const all = people();
    if (look && Object.keys(look).length) all[id] = look; else delete all[id];
    settings.store.peopleLooks = JSON.stringify(all);
    sync();
}

export const personLook = (id: string) => people()[id] ?? null;
export const peopleList = () => people();

export function lookOf(id: string): Look | null {
    const me = UserStore.getCurrentUser()?.id;
    const server = id === me && mine ? mine : (looks()[id]?.l as Look | undefined);
    const own = people()[id];
    if (!server && !own) return null;
    // your own name style for someone wins over theirs
    return { ...server, ...own };
}

/* ---------- putting it on Discord's users ----------
   User objects are immutable records: a changed copy (record.merge) is put in the store in place of the original,
   and the original is kept to go back to. Discord replaces records when someone changes, so this runs again after
   every UserStore change, only for people who have a look. */

const originals = new Map<string, any>();
const appliedKey = new WeakMap<object, string>();
let queued = false;

function userFields(look: Look, rec: any) {
    const f: Record<string, any> = {};
    if (look.f != null || look.x != null || look.c?.length) {
        const colors = look.c?.length ? look.c : rec.displayNameStyles?.colors ?? [];
        f.displayNameStyles = { fontId: look.f ?? 11, effectId: look.x ?? (colors.length > 1 ? 2 : 1), colors };
    }
    if (look.d) f.avatarDecorationData = { asset: look.d.a, skuId: look.d.s };
    if (look.n) f.collectibles = { ...rec.collectibles, nameplate: { asset: look.n.a, skuId: look.n.s, palette: look.n.p, label: look.n.t } };
    return f;
}

function sync() {
    queued = false;
    let users: Record<string, any>;
    try { users = UserStore.getUsers() as any; } catch { return; }
    let changed = false;
    const wanted = new Set<string>();
    const ids = new Set([...Object.keys(looks()), ...Object.keys(people())]);
    const me = UserStore.getCurrentUser()?.id;
    if (me && mine) ids.add(me);

    for (const id of ids) {
        const rec = users[id];
        const look = lookOf(id);
        if (!rec || !look) continue;
        const fields = userFields(look, originals.get(id) && appliedKey.has(rec) ? originals.get(id) : rec);
        if (!Object.keys(fields).length) continue;
        wanted.add(id);
        const key = JSON.stringify(fields);
        if (appliedKey.get(rec) === key) continue;
        const real = appliedKey.has(rec) ? originals.get(id) ?? rec : rec;
        try {
            const next = real.merge(fields);
            appliedKey.set(next, key);
            originals.set(id, real);
            users[id] = next;
            changed = true;
        } catch { /* not a record: leave it */ }
    }
    // looks that went away: back to Discord's own
    for (const [id, real] of originals) {
        if (wanted.has(id)) continue;
        if (users[id] && appliedKey.has(users[id])) { users[id] = real; changed = true; }
        originals.delete(id);
    }
    if (changed) UserStore.emitChange();
}

const schedule = () => { if (!queued) { queued = true; queueMicrotask(sync); } };

/** Your look while editing: shown on your own name / avatar right away. */
export function previewMine(look: Look | null) {
    mine = look;
    profileCache = new WeakMap();
    schedule();
}

/* ---------- profiles (patched in index.tsx) ---------- */

let profileCache = new WeakMap<object, any>();

/** UserProfileStore.getUserProfile: card colors, profile effect and frame. */
export function profileHook(profile: any) {
    if (!profile?.userId) return profile;
    const look = lookOf(profile.userId);
    if (!look || !(look.t || look.e || look.r)) return profile;
    const cached = profileCache.get(profile);
    if (cached) return cached;
    const out = {
        ...profile,
        premiumType: Math.max(profile.premiumType ?? 0, 2),
        ...(look.t ? { themeColors: look.t } : {}),
        ...(look.e ? { profileEffect: { skuId: look.e, expiresAt: null } } : {}),
        ...(look.r ? { profileFrame: { skuId: look.r, expiresAt: null } } : {}),
    };
    profileCache.set(profile, out);
    return out;
}

/** The profile banner: an uploaded one, unless the person has a real one. */
export function bannerHook(displayProfile: any) {
    const id = displayProfile?.userId;
    const b = id && lookOf(id)?.b;
    return b ? `${BADGE_API}/banner/${b}` : undefined;
}

/* ---------- name styles always on ----------
   Discord draws a name's color and effect (gradient, neon, glow, …) only while the name has its "showEffect" class,
   which chat and the member list only add on hover, so styled names looked plain (or, mid-effect, invisible) until
   pointed at. Discord's own rules are copied without that condition, so every styled name shows its style all the
   time, exactly as Discord draws it. The rules are read from Discord's stylesheets, so renamed classes still work. */

let nameStyleSheet: HTMLStyleElement | null = null;
let nameStyleTry = 0;

// The rules come from the source text of Discord's CSS file (fetched from Discord, cached by the browser): the
// browser's own copy of a rule can't give back a gradient written as a "background" shorthand with variables, and
// a copy without it would leave gradient names invisible.
async function alwaysShowNameStyles() {
    clearTimeout(nameStyleTry);
    const files = new Set<string>();
    for (const sheet of document.styleSheets) {
        let list: CSSRuleList;
        try { list = sheet.cssRules; } catch { continue; }
        if (sheet.href && [...list].some(r => r instanceof CSSStyleRule && /\.showEffect_[\w-]+\.container_/.test(r.selectorText))) files.add(sheet.href);
    }
    // Discord's CSS for this may load a bit later
    if (!files.size) { nameStyleTry = window.setTimeout(alwaysShowNameStyles, 3000); return; }
    const rules: string[] = [];
    for (const href of files) {
        let css: string;
        try { css = await (await fetch(href)).text(); } catch { continue; }
        for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const sel = m[1].trim();
            const hit = sel.match(/\.(showEffect_[\w-]+)\.(container_[\w-]+)/);
            if (!hit) continue;
            rules.push(`${sel.split(",").map(p => `html[data-dz-names] ${p.trim().replaceAll(`.${hit[1]}.${hit[2]}`, `.${hit[2]}`)}`).join(",")}{${m[2]}}`);
        }
    }
    if (!rules.length) return;
    nameStyleSheet ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: "terono-name-styles" }));
    nameStyleSheet.textContent = rules.join("\n");
}

/* ---------- start / stop ---------- */

let offList: (() => void) | null = null;

export function startCosmetics() {
    UserStore.addChangeListener(schedule);
    offList = onListChange(() => { profileCache = new WeakMap(); schedule(); });
    schedule();
    void alwaysShowNameStyles();
}

export function stopCosmetics() {
    UserStore.removeChangeListener(schedule);
    offList?.();
    clearTimeout(nameStyleTry);
    nameStyleSheet?.remove();
    nameStyleSheet = null;
    mine = null;
    const users = UserStore.getUsers() as any;
    for (const [id, real] of originals) if (users[id] && appliedKey.has(users[id])) users[id] = real;
    originals.clear();
    UserStore.emitChange();
}

/* ================= Discord's shop catalog ================= */

export interface Item { kind: "deco" | "plate" | "effect" | "frame"; sku: string; name: string; asset?: string; palette?: string; label?: string; img?: string; category: string; }

let catalog: Promise<Item[]> | null = null;

export function loadCatalog() {
    catalog ??= RestAPI.get({ url: "/collectibles-categories" }).then(({ body }: any) => {
        const out: Item[] = [];
        for (const c of body ?? []) for (const p of c.products ?? []) {
            const it = p.items?.[0];
            if (!it) continue;
            if (p.type === 0 && it.asset) out.push({ kind: "deco", sku: it.sku_id, name: p.name, asset: it.asset, category: c.name, img: `https://cdn.discordapp.com/avatar-decoration-presets/${it.asset}.png?size=96&passthrough=false` });
            else if (p.type === 2 && it.asset) out.push({ kind: "plate", sku: it.sku_id, name: p.name, asset: it.asset, palette: it.palette ?? "none", label: it.label ?? p.name, category: c.name, img: `https://cdn.discordapp.com/assets/collectibles/${it.asset}static.png` });
            else if (p.type === 1) out.push({ kind: "effect", sku: it.sku_id, name: it.title ?? p.name, category: c.name, img: it.thumbnailPreviewSrc ?? it.staticFrameSrc });
            else if (p.type === 3) out.push({ kind: "frame", sku: it.sku_id, name: p.name, category: c.name, label: it.label });
        }
        return out;
    }).catch(e => { catalog = null; throw e; });
    return catalog;
}

function pickItem(kind: Item["kind"], heading: string): Promise<Item | null | undefined> {
    return new Promise(resolve => {
        let done = false;
        const finish = (v: Item | null | undefined) => { if (!done) { done = true; resolve(v); } };
        openModal(props => (
            <Modal {...props} title={heading} size="lg"
                actions={[
                    { text: "None", variant: "secondary", onClick: () => { finish(null); props.onClose(); } },
                    { text: "Cancel", variant: "secondary", onClick: () => { finish(undefined); props.onClose(); } },
                ]}>
                <Catalog kind={kind} onPick={it => { finish(it); props.onClose(); }} />
            </Modal>
        ), { onCloseCallback: () => finish(undefined) });
    });
}

function Catalog({ kind, onPick }: { kind: Item["kind"]; onPick(it: Item): void; }) {
    const [items, setItems] = useState<Item[] | null>(null);
    const [error, setError] = useState("");
    const [q, setQ] = useState("");
    useEffect(() => { loadCatalog().then(all => setItems(all.filter(i => i.kind === kind))).catch(e => setError(String(e?.message ?? e))); }, []);
    const shown = useMemo(() => {
        const w = q.trim().toLowerCase();
        return (items ?? []).filter(i => !w || `${i.name} ${i.category}`.toLowerCase().includes(w)).slice(0, 240);
    }, [items, q]);
    if (error) return <p className="dz-look-note">Couldn't load Discord's shop: {error}</p>;
    if (!items) return <p className="dz-look-note">Loading Discord's shop…</p>;
    return (
        <div className="dz-cat">
            <input className="dz-input" autoFocus placeholder={`Search ${items.length} items or collections`} value={q} onChange={e => setQ(e.currentTarget.value)} />
            <div className={`dz-cat-grid dz-cat-${kind}`}>
                {shown.map(i => (
                    <button key={i.sku} className="dz-cat-item" title={`${i.name} · ${i.category}`} onClick={() => onPick(i)}>
                        {i.img ? <img src={i.img} alt="" loading="lazy" /> : <span className="dz-cat-noimg">{i.label ?? i.name}</span>}
                        <span className="dz-cat-name">{i.name}</span>
                    </button>
                ))}
            </div>
            {shown.length === 240 && <p className="dz-look-note">Showing the first 240: search to narrow it down.</p>}
        </div>
    );
}

/* ================= editors ================= */

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const num = (h: string) => parseInt(h.slice(1), 16);

/** Font, effect and colors for a name (yours, or someone's in People). */
export function NameStyleEditor({ look, onChange, sample }: { look: Look; onChange(l: Look): void; sample: string; }) {
    const fonts = useMemo(nameFonts, []);
    const colors = look.c ?? [];
    const effect = look.x ?? (colors.length > 1 ? 2 : 1);
    const multi = effect !== 1;
    const setColors = (c: number[]) => onChange({ ...look, c });
    return (
        <div className="dz-name-ed">
            <div className="dz-font-grid">
                {fonts.map(([id, name, cls]) => (
                    <button key={id} className={`dz-font-tile ${(look.f ?? 11) === id ? "dz-on" : ""}`} onClick={() => onChange({ ...look, f: id })}>
                        <span className={cls}>{sample}</span>
                        <small>{name}</small>
                    </button>
                ))}
            </div>
            <div className="dz-look-row">
                <label>Effect</label>
                <select className="dz-input" value={effect} onChange={e => onChange({ ...look, x: Number(e.currentTarget.value) })}>
                    {NAME_EFFECTS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
                <label>Colors</label>
                {(multi ? [0, 1] : [0]).map(i => (
                    <input key={i} type="color" className="dz-color" value={hex(colors[i] ?? (i ? 0x9b6dff : 0x429cff))}
                        onChange={e => { const c = [...colors]; c[i] = num(e.currentTarget.value); if (!multi) c.length = 1; else if (c[0] == null) c[0] = 0x429cff; setColors(c); }} />
                ))}
                {colors.length > 0 && <Button size="small" variant="secondary" onClick={() => setColors([])}>No color</Button>}
            </div>
        </div>
    );
}

async function toBase64(blob: Blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
}

// a banner: anything up to 20 MB in, a 900 KB max WEBP / GIF out (GIFs stay animated if they're small enough)
async function bannerFile(file: File): Promise<{ type: string; image: string; }> {
    if (file.type === "image/gif" && file.size <= 900 * 1024) return { type: "image/gif", image: await toBase64(file) };
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1200 / bmp.width);
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    for (const q of [0.9, 0.8, 0.65, 0.5, 0.35]) {
        const blob = await c.convertToBlob({ type: "image/webp", quality: q });
        if (blob.size <= 900 * 1024) return { type: "image/webp", image: await toBase64(blob) };
    }
    throw new Error("That picture is too big even after shrinking it");
}

/** Settings → You → Profile: your own look. */
export function MyLookPanel() {
    const me = UserStore.getCurrentUser();
    const [auth, setAuth] = useState<boolean | undefined>(undefined);
    const [look, setLookState] = useState<Look>(() => (looks()[me?.id]?.l as Look) ?? {});
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => { getAuth().then(a => setAuth(!!a)); loadCatalog().catch(() => { }); }, []);
    useEffect(() => () => previewMine(null), []);

    const set = (l: Look) => { setLookState(l); setDirty(true); previewMine(l); };
    const clear = (...keys: (keyof Look)[]) => { const l = { ...look }; for (const k of keys) delete l[k]; set(l); };

    async function choose(kind: Item["kind"], heading: string) {
        const it = await pickItem(kind, heading);
        if (it === undefined) return;
        if (kind === "deco") it ? set({ ...look, d: { a: it.asset!, s: it.sku } }) : clear("d");
        if (kind === "plate") it ? set({ ...look, n: { a: it.asset!, s: it.sku, p: it.palette ?? "none", t: it.label ?? it.name } }) : clear("n");
        if (kind === "effect") it ? set({ ...look, e: it.sku }) : clear("e");
        if (kind === "frame") it ? set({ ...look, r: it.sku }) : clear("r");
    }

    async function uploadBanner(file?: File) {
        if (!file) return;
        if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) return toast("Pick an image up to 20 MB.", "failure");
        setBusy(true);
        try {
            const r = await api("/me/banner", "PUT", await bannerFile(file));
            set({ ...look, b: r.hash });
            toast("Banner uploaded. Save to show it.", "success");
        } catch (e) {
            toast(`Couldn't upload: ${e instanceof Error ? e.message : e}`, "failure");
        }
        setBusy(false);
    }

    async function save() {
        setBusy(true);
        try {
            await api("/me/look", "PUT", { look });
            await refreshBadges();
            setDirty(false);
            toast("Saved. Everyone with Terono sees your profile like this now.", "success");
        } catch (e) {
            toast(`Couldn't save: ${e instanceof Error ? e.message : e}`, "failure");
        }
        setBusy(false);
    }

    if (!badgesReady()) return <p className="dz-look-note">Profiles aren't switched on in this build.</p>;
    if (auth === false) return (
        <section className="dz-set-group">
            <h3 className="dz-set-group-title">Connect once</h3>
            <p className="dz-look-note">Your profile look is shown to everyone with Terono. To make sure only you can change yours, connect once: Discord asks you to <b>Authorize</b>, and Terono only gets your user ID.</p>
            <div className="dz-look-actions"><Button onClick={async () => setAuth(await authorize())}>Connect with Discord</Button></div>
        </section>
    );

    const t = look.t ?? [0x1e1f22, 0x429cff];
    return (
        <div className="dz-look">
            <p className="dz-look-note">Discord's Nitro profile items, free: everyone using Terono sees them on you (in chat, the member list, profiles and calls). People without Terono see your normal profile. Changes show on your own name right away; <b>Save</b> shows them to everyone.</p>

            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Your name</h3>
                <NameStyleEditor look={look} onChange={set} sample={me?.globalName || me?.username || "Name"} />
            </section>

            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Avatar, nameplate, effect and frame</h3>
                <div className="dz-look-items">
                    <LookItem label="Avatar decoration" value={look.d ? "Chosen" : "None"} img={look.d && `https://cdn.discordapp.com/avatar-decoration-presets/${look.d.a}.png?size=96&passthrough=false`} onPick={() => choose("deco", "Avatar decoration")} />
                    <LookItem label="Nameplate" value={look.n?.t ? "Chosen" : "None"} img={look.n && `https://cdn.discordapp.com/assets/collectibles/${look.n.a}static.png`} onPick={() => choose("plate", "Nameplate")} />
                    <LookItem label="Profile effect" value={look.e ? "Chosen" : "None"} onPick={() => choose("effect", "Profile effect")} />
                    <LookItem label="Profile frame" value={look.r ? "Chosen" : "None"} onPick={() => choose("frame", "Profile frame")} />
                </div>
            </section>

            <section className="dz-set-group">
                <h3 className="dz-set-group-title">Profile card</h3>
                <div className="dz-look-row">
                    <label>Colors</label>
                    <input type="color" className="dz-color" value={hex(t[0])} onChange={e => set({ ...look, t: [num(e.currentTarget.value), t[1]] })} aria-label="Top color" />
                    <input type="color" className="dz-color" value={hex(t[1])} onChange={e => set({ ...look, t: [t[0], num(e.currentTarget.value)] })} aria-label="Bottom color" />
                    {look.t && <Button size="small" variant="secondary" onClick={() => clear("t")}>Remove</Button>}
                </div>
                <div className="dz-look-row">
                    <label>Banner</label>
                    {look.b && <img className="dz-look-banner" src={`${BADGE_API}/banner/${look.b}`} alt="" />}
                    <label className="dz-file-btn">{look.b ? "Change picture" : "Choose picture"}<input type="file" accept="image/*" disabled={busy} onChange={e => uploadBanner(e.currentTarget.files?.[0])} /></label>
                    {look.b && <Button size="small" variant="secondary" onClick={() => clear("b")}>Remove</Button>}
                </div>
                <p className="dz-look-note">A picture or GIF, shown at the top of your profile (it's made up to 1200 px wide and 900 KB).</p>
            </section>

            <div className="dz-look-actions">
                <Button variant="secondary" disabled={busy} onClick={() => set({})}>Reset all</Button>
                <Button disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
            </div>
        </div>
    );
}

function LookItem({ label, value, img, onPick }: { label: string; value: string; img?: string | false; onPick(): void; }) {
    return (
        <button className="dz-look-item" onClick={onPick}>
            <span className="dz-look-thumb">{img ? <img src={img} alt="" /> : <span>+</span>}</span>
            <span><b>{label}</b><small>{value}</small></span>
        </button>
    );
}

/* ================= People: your own name styles for others ================= */

export function openPersonEditor(userId: string) {
    const u = UserStore.getUser(userId);
    let draft: Look = personLook(userId) ?? {};
    openModal(props => (
        <Modal {...props} title={`Name style for ${u?.globalName || u?.username || "this person"}`} size="md"
            actions={[
                { text: "Remove", variant: "secondary", onClick: () => { setPerson(userId, null); props.onClose(); } },
                { text: "Save", variant: "primary", onClick: () => { setPerson(userId, draft); props.onClose(); } },
            ]}>
            <p className="dz-look-note">Only you see this: their name shows in this font and color everywhere in your Discord.</p>
            <PersonDraft initial={draft} sample={u?.globalName || u?.username || "Name"} onChange={l => { draft = l; }} />
        </Modal>
    ));
}

function PersonDraft({ initial, sample, onChange }: { initial: Look; sample: string; onChange(l: Look): void; }) {
    const [l, setL] = useState(initial);
    return <NameStyleEditor look={l} sample={sample} onChange={n => { setL(n); onChange(n); }} />;
}

export function PeoplePanel() {
    const [, rerender] = useState(0);
    const all = peopleList();
    const ids = Object.keys(all);
    return (
        <section className="dz-set-group">
            <h3 className="dz-set-group-title">People</h3>
            <p className="dz-look-note">Give anyone's name your own font and color. Right-click a person → <b>Name style…</b>. Only you see these.</p>
            {ids.length === 0 && <p className="dz-look-note">Nobody yet.</p>}
            {ids.map(id => {
                const u = UserStore.getUser(id);
                return (
                    <div key={id} className="dz-person">
                        {u && <img src={u.getAvatarURL(undefined, 32)} alt="" />}
                        <span>{u?.globalName || u?.username || id}</span>
                        <Button size="small" variant="secondary" onClick={() => openPersonEditor(id)}>Edit</Button>
                        <Button size="small" variant="secondary" onClick={() => { setPerson(id, null); rerender(x => x + 1); }}>Remove</Button>
                    </div>
                );
            })}
        </section>
    );
}

export const personMenu: NavContextMenuPatchCallback = (children, { user }: { user?: { id: string; }; }) => {
    if (!user?.id) return;
    children.push(
        <Menu.MenuItem id="dz-name-style" key="dz-name-style" label="Name style…" action={() => openPersonEditor(user.id)} />
    );
};

/* ================= avatar shape (everyone's, only for you) =================
   Each avatar is cut round by its own small SVG mask; without the mask, rounded corners give the shape (the status
   dot then sits on the corner). Plain avatar pictures (chat) just get the corners. Pure CSS. */

export const AVATAR_CSS = `
html[data-dz-avatars] .mask__44b0c foreignObject { mask: none !important; }
html[data-dz-avatars="rounded"] .mask__44b0c foreignObject :is(img, .avatarStack__44b0c),
html[data-dz-avatars="rounded"] img[class*="avatar"]:not(foreignObject img) { border-radius: 28% !important; }
html[data-dz-avatars="square"] .mask__44b0c foreignObject :is(img, .avatarStack__44b0c),
html[data-dz-avatars="square"] img[class*="avatar"]:not(foreignObject img) { border-radius: 12% !important; }
`;

export const COSMETICS_CSS = `
.dz-look { display: flex; flex-direction: column; gap: 14px; }
.dz-look-note { margin: 4px 0 10px; font-size: 13px; line-height: 1.45; color: var(--text-muted, #aaa); }
.dz-look-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 0; color: var(--text-default, #fff); }
.dz-look-row > label:not(.dz-file-btn) { min-width: 64px; font: 600 13px var(--font-primary, "gg sans", sans-serif); color: var(--text-muted, #aaa); }
.dz-look-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dz-input { box-sizing: border-box; height: 34px; padding: 0 10px; border-radius: 10px; font: 500 14px var(--font-primary, "gg sans", sans-serif);
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 5%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 10%, transparent); outline: none; }
.dz-input:focus { border-color: var(--dz-accent, #429cff); }
select.dz-input option { background: var(--dz-card, #070708); }
.dz-color { width: 34px; height: 30px; padding: 0; border: none; background: none; cursor: pointer; }
.dz-font-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; padding: 6px 0; }
.dz-font-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 9px 11px; border-radius: 12px; cursor: pointer; text-align: left; overflow: hidden;
    color: var(--text-default, #fff); background: color-mix(in srgb, var(--dz-text, #f1f2f4) 4%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-font-tile > span { font-size: 16px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.dz-font-tile small { font-size: 11px; color: var(--text-muted, #aaa); }
.dz-font-tile:hover { border-color: color-mix(in srgb, var(--dz-accent, #429cff) 50%, transparent); }
.dz-font-tile.dz-on { border-color: var(--dz-accent, #429cff); background: color-mix(in srgb, var(--dz-accent, #429cff) 14%, transparent); }
.dz-look-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; padding: 6px 0 10px; }
.dz-look-item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--text-default, #fff);
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 4%, transparent); border: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 8%, transparent); }
.dz-look-item:hover { border-color: var(--dz-accent, #429cff); }
.dz-look-item small { display: block; color: var(--text-muted, #aaa); font-size: 12px; }
.dz-look-thumb { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: 10px; overflow: hidden; background: color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-look-thumb img { width: 100%; height: 100%; object-fit: contain; }
.dz-look-thumb span { font-size: 22px; color: var(--text-muted, #aaa); }
.dz-look-banner { height: 40px; width: 120px; object-fit: cover; border-radius: 8px; }
.dz-file-btn { position: relative; display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border-radius: 8px; cursor: pointer; font: 600 13px var(--font-primary, "gg sans", sans-serif);
    color: #fff; background: var(--dz-accent, #429cff); }
.dz-file-btn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.dz-cat { display: flex; flex-direction: column; gap: 10px; padding-bottom: 12px; }
.dz-cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; max-height: 56vh; overflow-y: auto; padding: 2px; }
.dz-cat-plate, .dz-cat-effect { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.dz-cat-item { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border-radius: 12px; cursor: pointer; color: var(--text-default, #fff);
    background: color-mix(in srgb, var(--dz-text, #f1f2f4) 4%, transparent); border: 1px solid transparent; }
.dz-cat-item:hover { border-color: var(--dz-accent, #429cff); }
.dz-cat-item img { width: 100%; aspect-ratio: 1; object-fit: contain; }
.dz-cat-plate .dz-cat-item img { aspect-ratio: 4 / 1; object-fit: cover; border-radius: 8px; }
.dz-cat-effect .dz-cat-item img { aspect-ratio: 3 / 4; object-fit: cover; border-radius: 8px; }
.dz-cat-noimg { display: grid; place-items: center; min-height: 64px; padding: 6px; font-size: 11px; color: var(--text-muted, #aaa); text-align: center; }
.dz-cat-name { font-size: 12px; text-align: center; line-height: 1.25; }
.dz-person { display: flex; align-items: center; gap: 10px; padding: 6px 0; color: var(--text-default, #fff); }
.dz-person img { width: 28px; height: 28px; border-radius: 50%; }
.dz-person span { flex: 1; }
`;
