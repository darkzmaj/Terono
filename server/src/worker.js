/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Terono badges: who wears which Terono badge.
//
// GET    /badges             everyone's badges (what the plugin shows on profiles)
// GET    /img/<hash>.png     an uploaded badge image
// POST   /hello              { id, v }  marks a Terono 1.0.5 - 1.1.5 user for the OG badge
// GET    /authorize?code=    Discord sign-in (redirect target of the in-app "Authorize" window) -> { token, id }
// GET    /me                 the signed-in user's badges
// PUT    /me/badge/<0-2>     { name, effect, color, image (base64 PNG, 64x64, static) }
// DELETE /me/badge/<0-2>
// PUT    /me/official        { badges: [key, ...] }
// POST   /seen               { id }  counts a user in the Terono user number (stored as a hash; setting can turn it off)
// GET    /stats              { online, day, total }: the user number, readable only by the owner
// PUT    /me/look            { look }  your profile look (name font / effect / colors, avatar decoration, nameplate,
//                             profile effect, card colors, banner), shown to everyone with Terono; DELETE removes it
// PUT    /me/banner          { image (base64 PNG / JPEG / WEBP / GIF, up to 900 KB), type }  -> { hash }
// GET    /banner/<hash>      an uploaded banner
// POST   /share              { profile }  stores a shared Terono profile -> { code } (30 characters)
// POST   /share/get          { code }     -> { profile }
// POST   /report             { report }   a troubleshooting report -> { code } (8 characters, kept 30 days)
// GET    /report/<code>      the report, readable only by the owner
// GET    /live               WebSocket: every badge change as it happens, { u: userId, e: entry | null }

// official-look badges people may wear; Discord Staff, Partner and Moderator Programs are left out on purpose
const OFFICIAL = new Set([
    "hypesquad", "bravery", "brilliance", "balance", "bughunter", "bughunter_gold", "early_supporter", "verified_developer",
    "active_developer", "nitro", "booster_1", "booster_2", "booster_3", "booster_4", "booster_5", "booster_6", "booster_7",
    "booster_8", "booster_9", "legacy_username", "quest", "supports_commands", "automod",
    "tenure_1", "tenure_3", "tenure_6", "tenure_12", "tenure_24", "tenure_36", "tenure_60", "tenure_72", "gifting", "level67",
    "age_seed", "age_sprout", "age_sapling", "age_bud", "age_blossom", "age_redwood", "age_sequoia", "age_bristlecone",
    "age_stromatolite", "age_primordial", "gift_patron", "gift_luminary", "gift_icon", "gift_hero", "gift_legend",
    "orbs", "last_meadow",
]);
const EFFECTS = new Set(["none", "glow", "outline"]);
const SNOWFLAKE = /^\d{17,20}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_PNG = 48 * 1024;

export default {
    async fetch(req, env) {
        if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
        try {
            const res = await route(req, env, new URL(req.url));
            return res.status === 101 ? res : cors(res);
        } catch (e) {
            console.error(e);
            return cors(json({ error: "Server error" }, 500));
        }
    },
};

async function route(req, env, url) {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const m = req.method;

    if (m === "GET" && path === "/badges") return badges(env);
    if (m === "GET" && path === "/live") return env.HUB.get(env.HUB.idFromName("hub")).fetch(req);
    if (m === "GET" && path.startsWith("/img/")) return image(env, path.slice(5).replace(/\.png$/, ""));
    if (m === "GET" && path.startsWith("/banner/")) return banner(env, path.slice(8));
    if (m === "POST" && path === "/share") return shareSave(req, env);
    if (m === "POST" && path === "/share/get") return shareGet(req, env);
    if (m === "POST" && path === "/report") return reportSave(req, env);
    if (m === "GET" && path.startsWith("/report/")) {
        const user = await session(req, env);
        if (!user) return json({ error: "Not signed in" }, 401);
        return reportGet(env, user, path.slice(8));
    }
    if (m === "POST" && path === "/hello") return hello(req, env);
    if (m === "GET" && path === "/authorize") return authorize(env, url);
    if (m === "POST" && path === "/seen") return seen(req, env);

    if (path === "/stats") {
        const user = await session(req, env);
        if (!user) return json({ error: "Not signed in" }, 401);
        if (m === "GET") return stats(env, user);
    }

    if (path === "/me" || path.startsWith("/me/")) {
        const user = await session(req, env);
        if (!user) return json({ error: "Not signed in" }, 401);
        if (m === "GET" && path === "/me") return me(env, user);
        const slot = path.match(/^\/me\/badge\/([0-2])$/);
        if (slot && m === "PUT") return putBadge(req, env, user, Number(slot[1]));
        if (slot && m === "DELETE") return delBadge(env, user, Number(slot[1]));
        if (m === "PUT" && path === "/me/official") return putOfficial(req, env, user);
        if (m === "PUT" && path === "/me/look") return putLook(req, env, user);
        if (m === "DELETE" && path === "/me/look") return delLook(env, user);
        if (m === "PUT" && path === "/me/banner") return putBanner(req, env, user);
    }
    return json({ error: "Not found" }, 404);
}

/* ---------------- public ---------------- */

async function badges(env) {
    const snap = await env.DB.prepare("SELECT json, version, dirty FROM snapshot WHERE id = 1").first();
    if (snap && !snap.dirty) return json(JSON.parse(snap.json), 200, "public, max-age=30");

    // rebuild once after a change
    const users = await env.DB.prepare("SELECT id, og, official FROM users WHERE og = 1 OR official != '[]'").all();
    const custom = await env.DB.prepare("SELECT user_id, slot, name, effect, color, hash FROM badges ORDER BY user_id, slot").all();
    const out = {};
    for (const u of users.results) {
        const e = out[u.id] = {};
        if (u.og) e.o = 1;
        const off = JSON.parse(u.official);
        if (off.length) e.b = off;
    }
    for (const b of custom.results) (out[b.user_id] ??= {}).c = [...(out[b.user_id].c ?? []), { s: b.slot, n: b.name, e: b.effect, k: b.color, h: b.hash }];
    const looks = await env.DB.prepare("SELECT user_id, json FROM looks").all();
    for (const l of looks.results) (out[l.user_id] ??= {}).l = JSON.parse(l.json);

    const version = Date.now();
    const body = { v: version, u: out };
    await env.DB.prepare("UPDATE snapshot SET json = ?, version = ?, dirty = 0 WHERE id = 1").bind(JSON.stringify(body), version).run();
    return json(body, 200, "public, max-age=30");
}

async function image(env, hash) {
    if (!/^[0-9a-f]{20}$/.test(hash)) return json({ error: "Not found" }, 404);
    const row = await env.DB.prepare("SELECT image FROM badges WHERE hash = ? LIMIT 1").bind(hash).first();
    if (!row) return json({ error: "Not found" }, 404);
    return new Response(new Uint8Array(row.image), {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
}

// OG badge: the plugin says hello once per account while it is version 1.0.5 - 1.1.5
async function hello(req, env) {
    const body = await req.json().catch(() => null);
    if (!body || !SNOWFLAKE.test(body.id) || !inOgRange(body.v)) return json({ error: "Bad request" }, 400);
    const res = await env.DB.prepare("INSERT INTO users (id, og, updated) VALUES (?, 1, ?) ON CONFLICT (id) DO UPDATE SET og = 1, updated = excluded.updated WHERE og = 0")
        .bind(body.id, Date.now()).run();
    if (res.meta.changes) await changed(env, body.id);
    return json({ ok: true });
}

function inOgRange(v) {
    // 3 or 4 parts (1.0.8.1)
    const m = typeof v === "string" && v.match(/^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/);
    if (!m) return false;
    const n = Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]);
    return n >= 1_000_005 && n <= 1_001_005;
}

/* ---------------- user count ----------------
   Only the owner can read it. "total" and "day" come from a table of one-way hashes of Discord user IDs (written about
   once a day per user by the plugin); "online" is the number of distinct users whose live connection is marked as
   counted (see Hub). The plugin sends nothing when its "Count me as a Terono user" setting is off. */

const OWNER_ID = "1364930123656335402";

async function seen(req, env) {
    const body = await req.json().catch(() => null);
    if (!body || !SNOWFLAKE.test(body.id)) return json({ error: "Bad request" }, 400);
    const now = Date.now();
    const h = await sha256Hex(`terono-seen:${body.id}`);
    await env.DB.prepare("INSERT INTO seen (h, first, last) VALUES (?, ?, ?) ON CONFLICT (h) DO UPDATE SET last = excluded.last WHERE seen.last < excluded.last - 3600000")
        .bind(h, now, now).run();
    return json({ ok: true });
}

async function stats(env, user) {
    if (user !== (env.OWNER_ID || OWNER_ID)) return json({ error: "Not allowed" }, 403);
    const row = await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(last > ?), 0) AS day FROM seen").bind(Date.now() - 24 * 3600 * 1000).first();
    const online = await (await env.HUB.get(env.HUB.idFromName("hub")).fetch("https://hub/count")).json();
    return json({ online: online.n, day: row.day, total: row.total });
}

/* ---------------- sign-in ---------------- */

async function authorize(env, url) {
    const code = url.searchParams.get("code");
    if (!code) return json({ error: "Missing code" }, 400);

    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: `${url.origin}/authorize`,
        }),
    });
    if (!tokenRes.ok) return json({ error: "Discord sign-in failed" }, 401);
    const { access_token } = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
    if (!userRes.ok) return json({ error: "Discord sign-in failed" }, 401);
    const user = await userRes.json();
    if (!SNOWFLAKE.test(user.id)) return json({ error: "Discord sign-in failed" }, 401);

    // only the user ID is kept; Discord's access token is not stored
    const token = randomToken();
    await env.DB.batch([
        env.DB.prepare("INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)").bind(await sha256Hex(token), user.id, Date.now()),
        env.DB.prepare("INSERT OR IGNORE INTO users (id, updated) VALUES (?, ?)").bind(user.id, Date.now()),
    ]);
    return json({ token, id: user.id });
}

async function session(req, env) {
    const token = req.headers.get("Authorization");
    if (!token || token.length > 100) return null;
    const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token = ?").bind(await sha256Hex(token)).first();
    return row?.user_id ?? null;
}

/* ---------------- your badges ---------------- */

async function me(env, user) {
    const u = await env.DB.prepare("SELECT og, official FROM users WHERE id = ?").bind(user).first();
    const custom = await env.DB.prepare("SELECT slot, name, effect, color, hash FROM badges WHERE user_id = ? ORDER BY slot").bind(user).all();
    return json({
        id: user,
        og: !!u?.og,
        official: u ? JSON.parse(u.official) : [],
        custom: custom.results.map(b => ({ s: b.slot, n: b.name, e: b.effect, k: b.color, h: b.hash })),
    });
}

async function putBadge(req, env, user, slot) {
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 40) return json({ error: "Name must be 1-40 characters" }, 400);
    if (!EFFECTS.has(body.effect)) return json({ error: "Bad effect" }, 400);
    if (!HEX.test(body.color)) return json({ error: "Bad color" }, 400);
    if (typeof body.image !== "string" || body.image.length > MAX_PNG * 1.4) return json({ error: "Image too large" }, 400);

    let png;
    try {
        png = Uint8Array.from(atob(body.image), c => c.charCodeAt(0));
    } catch {
        return json({ error: "Bad image" }, 400);
    }
    const problem = checkPng(png);
    if (problem) return json({ error: problem }, 400);

    const hash = (await sha256Hex(png)).slice(0, 20);
    await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO users (id, updated) VALUES (?, ?)").bind(user, Date.now()),
        env.DB.prepare("INSERT INTO badges (user_id, slot, name, effect, color, hash, image) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, slot) DO UPDATE SET name = excluded.name, effect = excluded.effect, color = excluded.color, hash = excluded.hash, image = excluded.image")
            .bind(user, slot, name, body.effect, body.color.toLowerCase(), hash, png),
    ]);
    await changed(env, user);
    return json({ ok: true, hash });
}

async function delBadge(env, user, slot) {
    await env.DB.prepare("DELETE FROM badges WHERE user_id = ? AND slot = ?").bind(user, slot).run();
    await changed(env, user);
    return json({ ok: true });
}

async function putOfficial(req, env, user) {
    const body = await req.json().catch(() => null);
    const list = Array.isArray(body?.badges) ? [...new Set(body.badges)] : null;
    if (!list || list.length > OFFICIAL.size || !list.every(k => OFFICIAL.has(k))) return json({ error: "Bad badge list" }, 400);
    await env.DB.prepare("INSERT INTO users (id, official, updated) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET official = excluded.official, updated = excluded.updated")
        .bind(user, JSON.stringify(list), Date.now()).run();
    await changed(env, user);
    return json({ ok: true });
}

/* ---------------- profile looks ----------------
   What a Terono user shows to other Terono users: Discord's own name styles, avatar decorations, nameplates and
   profile effects (by their shop IDs, drawn by Discord itself), profile card colors and an uploaded banner. */

const SKU = /^\d{17,20}$/;
const COLOR = v => Number.isInteger(v) && v >= 0 && v <= 0xffffff;

function cleanLook(b) {
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;
    const l = {};
    if (b.f != null) { if (!Number.isInteger(b.f) || b.f < 1 || b.f > 64) return null; l.f = b.f; }
    if (b.x != null) { if (!Number.isInteger(b.x) || b.x < 1 || b.x > 64) return null; l.x = b.x; }
    if (b.c != null) { if (!Array.isArray(b.c) || b.c.length > 5 || !b.c.every(COLOR)) return null; if (b.c.length) l.c = b.c; }
    if (b.d != null) {
        if (typeof b.d.a !== "string" || !/^(a_)?[0-9a-f]{32}$/.test(b.d.a) || !SKU.test(b.d.s)) return null;
        l.d = { a: b.d.a, s: b.d.s };
    }
    if (b.n != null) {
        if (typeof b.n.a !== "string" || !/^nameplates\/[\w/-]{1,120}\/$/.test(b.n.a) || b.n.a.includes("//") || !SKU.test(b.n.s)) return null;
        l.n = { a: b.n.a, s: b.n.s, p: typeof b.n.p === "string" && /^[a-z_]{1,24}$/.test(b.n.p) ? b.n.p : "none", t: String(b.n.t ?? "").slice(0, 160) };
    }
    if (b.e != null) { if (!SKU.test(b.e)) return null; l.e = b.e; }
    if (b.r != null) { if (!SKU.test(b.r)) return null; l.r = b.r; }
    if (b.t != null) { if (!Array.isArray(b.t) || b.t.length !== 2 || !b.t.every(COLOR)) return null; l.t = b.t; }
    if (b.b != null) { if (!/^[0-9a-f]{20}$/.test(b.b)) return null; l.b = b.b; }
    return l;
}

async function putLook(req, env, user) {
    const body = await req.json().catch(() => null);
    const look = cleanLook(body?.look);
    if (!look) return json({ error: "Bad look" }, 400);
    if (!Object.keys(look).length) return delLook(env, user);
    await env.DB.prepare("INSERT INTO looks (user_id, json, updated) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, updated = excluded.updated")
        .bind(user, JSON.stringify(look), Date.now()).run();
    await changed(env, user);
    return json({ ok: true, look });
}

async function delLook(env, user) {
    await env.DB.prepare("DELETE FROM looks WHERE user_id = ?").bind(user).run();
    await changed(env, user);
    return json({ ok: true });
}

const BANNER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BANNER = 900 * 1024;

async function putBanner(req, env, user) {
    const body = await req.json().catch(() => null);
    if (!BANNER_TYPES.has(body?.type) || typeof body.image !== "string" || body.image.length > MAX_BANNER * 1.4) return json({ error: "Use a PNG, JPEG, WEBP or GIF up to 900 KB" }, 400);
    let img;
    try { img = Uint8Array.from(atob(body.image), c => c.charCodeAt(0)); } catch { return json({ error: "Bad image" }, 400); }
    if (img.length > MAX_BANNER || !sniff(img, body.type)) return json({ error: "Use a PNG, JPEG, WEBP or GIF up to 900 KB" }, 400);
    const hash = (await sha256Hex(img)).slice(0, 20);
    // one banner per person: the old one goes
    await env.DB.batch([
        env.DB.prepare("DELETE FROM banners WHERE user_id = ? AND hash != ?").bind(user, hash),
        env.DB.prepare("INSERT OR IGNORE INTO banners (hash, user_id, type, image) VALUES (?, ?, ?, ?)").bind(hash, user, body.type, img),
    ]);
    return json({ ok: true, hash });
}

// the bytes really are the image type claimed
function sniff(b, type) {
    const at = (sig, o = 0) => sig.every((v, i) => b[o + i] === v);
    if (type === "image/png") return at([137, 80, 78, 71]);
    if (type === "image/jpeg") return at([255, 216, 255]);
    if (type === "image/gif") return at([71, 73, 70, 56]);
    return at([82, 73, 70, 70]) && at([87, 69, 66, 80], 8);
}

async function banner(env, hash) {
    if (!/^[0-9a-f]{20}$/.test(hash)) return json({ error: "Not found" }, 404);
    const row = await env.DB.prepare("SELECT type, image FROM banners WHERE hash = ?").bind(hash).first();
    if (!row) return json({ error: "Not found" }, 404);
    return new Response(new Uint8Array(row.image), {
        headers: { "Content-Type": row.type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
}

/* ---------------- shared profiles ----------------
   A Terono profile (a saved look) under a 30-character code people can paste to load it. The plugin shows the
   code with "//" between the characters; that's only presentation, the code itself is the 30 characters. */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789$#@%&*+=?!";
const MAX_SHARE = 120 * 1024;

function randomCode(n, chars) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return [...bytes].map(b => chars[b % chars.length]).join("");
}

async function shareSave(req, env) {
    const text = await req.text();
    if (text.length > MAX_SHARE) return json({ error: "Profile too large" }, 400);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Bad request" }, 400); }
    if (!body?.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) return json({ error: "Bad profile" }, 400);
    const code = randomCode(30, CODE_CHARS);
    await env.DB.prepare("INSERT INTO shares (code, json, created) VALUES (?, ?, ?)").bind(code, JSON.stringify(body.profile), Date.now()).run();
    return json({ code });
}

async function shareGet(req, env) {
    const body = await req.json().catch(() => null);
    const code = typeof body?.code === "string" ? body.code.replace(/\/\/|\s/g, "") : "";
    if (code.length !== 30) return json({ error: "That isn't a Terono profile code" }, 400);
    const row = await env.DB.prepare("SELECT json FROM shares WHERE code = ?").bind(code).first();
    if (!row) return json({ error: "No profile with that code" }, 404);
    return json({ profile: JSON.parse(row.json) });
}

/* ---------------- troubleshooting reports ----------------
   Someone with a problem sends their Terono report and gets a short code to give the creator, who opens it in the
   plugin (signed in). Reports are kept 30 days. */

const MAX_REPORT = 200 * 1024;

async function reportSave(req, env) {
    const text = await req.text();
    if (text.length > MAX_REPORT) return json({ error: "Report too large" }, 400);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Bad request" }, 400); }
    if (!body?.report || typeof body.report !== "object") return json({ error: "Bad report" }, 400);
    const code = randomCode(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    await env.DB.batch([
        env.DB.prepare("DELETE FROM reports WHERE created < ?").bind(Date.now() - 30 * 24 * 3600 * 1000),
        env.DB.prepare("INSERT INTO reports (code, json, created) VALUES (?, ?, ?)").bind(code, JSON.stringify(body.report), Date.now()),
    ]);
    return json({ code });
}

async function reportGet(env, user, code) {
    if (user !== (env.OWNER_ID || OWNER_ID)) return json({ error: "Not allowed" }, 403);
    const row = await env.DB.prepare("SELECT json, created FROM reports WHERE code = ?").bind(code.toUpperCase()).first();
    if (!row) return json({ error: "No report with that code" }, 404);
    return json({ report: JSON.parse(row.json), created: row.created });
}

/* ---------------- helpers ---------------- */

// a real, static (not animated) 64x64 PNG
function checkPng(b) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (b.length < 33 || b.length > MAX_PNG || !sig.every((v, i) => b[i] === v)) return "Not a PNG image";
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (String.fromCharCode(...b.slice(12, 16)) !== "IHDR") return "Not a PNG image";
    if (dv.getUint32(16) !== 64 || dv.getUint32(20) !== 64) return "Image must be 64x64";
    for (let at = 8; at + 8 <= b.length;) {
        const len = dv.getUint32(at);
        const type = String.fromCharCode(...b.slice(at + 4, at + 8));
        if (type === "acTL") return "Animated images aren't allowed";
        if (type === "IEND") break;
        at += 12 + len;
    }
    return null;
}

const dirty = env => env.DB.prepare("UPDATE snapshot SET dirty = 1 WHERE id = 1").run();

// one user's entry, as in /badges
async function entryOf(env, id) {
    const u = await env.DB.prepare("SELECT og, official FROM users WHERE id = ?").bind(id).first();
    const custom = await env.DB.prepare("SELECT slot, name, effect, color, hash FROM badges WHERE user_id = ? ORDER BY slot").bind(id).all();
    const e = {};
    if (u?.og) e.o = 1;
    const off = u ? JSON.parse(u.official) : [];
    if (off.length) e.b = off;
    if (custom.results.length) e.c = custom.results.map(b => ({ s: b.slot, n: b.name, e: b.effect, k: b.color, h: b.hash }));
    const look = await env.DB.prepare("SELECT json FROM looks WHERE user_id = ?").bind(id).first();
    if (look) e.l = JSON.parse(look.json);
    return Object.keys(e).length ? e : null;
}

// after a change: the list is rebuilt on its next download, and everyone connected gets the change right away
async function changed(env, id) {
    await dirty(env);
    const entry = await entryOf(env, id);
    await env.HUB.get(env.HUB.idFromName("hub")).fetch("https://hub/broadcast", { method: "POST", body: JSON.stringify({ u: id, e: entry }) });
}

/* ---------------- live updates ----------------
   One Durable Object holds every open connection (hibernating, so idle connections cost nothing) and sends each
   change to all of them. */

export class Hub {
    constructor(state) {
        this.state = state;
        // keep-alive answered by Cloudflare itself, without waking this object
        state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }

    async fetch(req) {
        if (new URL(req.url).pathname === "/broadcast") {
            const msg = await req.text();
            for (const ws of this.state.getWebSockets()) {
                try { ws.send(msg); } catch { /* closing */ }
            }
            return new Response("ok");
        }
        if (new URL(req.url).pathname === "/count") {
            const users = new Set();
            for (const ws of this.state.getWebSockets()) {
                const a = ws.deserializeAttachment();
                if (a?.u) users.add(a.u);
            }
            return Response.json({ n: users.size });
        }
        if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
        const [client, server] = Object.values(new WebSocketPair());
        this.state.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
    }

    // clients only listen, apart from "hi:<user id>" / "bye": whether this connection counts as an online Terono user
    // (the "Count me" setting). Anything else is ignored (a ping keeps some networks from dropping the connection).
    webSocketMessage(ws, msg) {
        if (typeof msg !== "string") return;
        const id = msg.startsWith("hi:") ? msg.slice(3) : "";
        if (SNOWFLAKE.test(id)) ws.serializeAttachment({ u: id });
        else if (msg === "bye") ws.serializeAttachment({});
    }

    webSocketClose(ws, code) {
        try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch { /* already closed */ }
    }
}

function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(data) {
    const buf = await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data);
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function json(body, status = 200, cache = "no-store") {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

function cors(res) {
    const h = new Headers(res.headers);
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    h.set("Access-Control-Max-Age", "86400");
    return new Response(res.body, { status: res.status, headers: h });
}
