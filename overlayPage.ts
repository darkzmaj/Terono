/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* The Terono overlay's page: its own see-through window over games and other apps (see native.ts).
   It only shows what Discord sends it (the call, notifications, your Terono look) and asks Discord to act by
   logging "dz:{json}", which the main process forwards. No Node, no network besides avatars and your font.
   It's drawn in your Terono look: the same panel color (glass or solid), accent, text color, corners and font. */

const ICONS = {
    speaker: "M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2l1.4-1.4Z",
    mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z",
    micOff: "M15 11V5a3 3 0 0 0-5.9-.8L15 10.1V11Zm4 0h-2c0 .7-.2 1.4-.4 2l1.5 1.5c.6-1 .9-2.2.9-3.5ZM4.3 3 3 4.3l6 6V11a3 3 0 0 0 4.6 2.5l1.5 1.5A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.9V21h2v-3.1c1-.1 1.9-.5 2.7-1L19.7 21l1.3-1.3L4.3 3Z",
    headphones: "M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h2a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9Z",
    deafOff: "M4.3 3 3 4.3l3.4 3.4A9 9 0 0 0 3 12v6a3 3 0 0 0 3 3h2v-8H5v-1c0-1.4.4-2.7 1.1-3.8L16 18.1V21h2v-.9l1.7 1.7 1.3-1.3L4.3 3ZM12 5a7 7 0 0 1 7 7v1h-3v.2l5 5V12a9 9 0 0 0-14.1-7.4l1.5 1.4A7 7 0 0 1 12 5Z",
    open: "M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    leave: "M21.7 15.3c-1.2 1.2-4 1.2-4 1.2l-.5-2.6a10 10 0 0 0-10.4 0l-.5 2.6s-2.8 0-4-1.2C1 13.7 2.6 11 12 11s11 2.7 9.7 4.3Z",
};
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;

export const OVERLAY_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Terono overlay</title><style>
:root { --accent: #429cff; --panel: #070708; --alpha: 86%; --text: #f1f2f4; --muted: color-mix(in srgb, var(--text) 62%, transparent); --radius: 16px; --font: "gg sans"; --opacity: 1; }
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; overflow: hidden; height: 100%; font: 500 14px var(--font), "Segoe UI", system-ui, sans-serif; color: var(--text); user-select: none; }
body { opacity: var(--opacity); }
#shade { position: fixed; inset: 0; background: rgb(0 0 0 / 40%); opacity: 0; transition: opacity .18s; pointer-events: none; }
body.live #shade { opacity: 1; pointer-events: auto; }
#dock { position: fixed; display: flex; flex-direction: column; gap: 8px; width: 304px; }
body[data-corner^="top"] #dock { top: 18px; } body[data-corner^="bottom"] #dock { bottom: 18px; flex-direction: column-reverse; }
body[data-corner$="left"] #dock { left: 18px; } body[data-corner$="right"] #dock { right: 18px; }
.card { position: relative; background: color-mix(in srgb, var(--panel) var(--alpha), transparent); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: var(--radius); box-shadow: 0 12px 32px rgb(0 0 0 / 38%), inset 0 1px 0 color-mix(in srgb, var(--text) 6%, transparent); overflow: hidden; }
body.glass .card { backdrop-filter: blur(14px) saturate(1.2); }
#call { padding: 10px; display: none; } body.voice #call { display: block; }
.head { display: flex; align-items: center; gap: 8px; padding: 2px 4px 9px; }
.head .ic { display: grid; place-items: center; width: 24px; height: 24px; border-radius: calc(var(--radius) * .45); color: #fff; background: var(--accent); flex: none; }
.head .tx { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.head .name { font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .where { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .count { font-size: 11px; font-weight: 700; color: var(--muted); }
.who { display: flex; flex-direction: column; gap: 2px; max-height: 360px; overflow: hidden; }
.p { display: flex; align-items: center; gap: 9px; padding: 4px 5px; border-radius: calc(var(--radius) * .6); transition: background .12s; }
.p img { width: 28px; height: 28px; border-radius: 50%; box-shadow: 0 0 0 2px transparent; transition: box-shadow .12s; flex: none; background: color-mix(in srgb, var(--text) 10%, transparent); }
.p.talk { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.p.talk img { box-shadow: 0 0 0 2px var(--accent), 0 0 12px color-mix(in srgb, var(--accent) 70%, transparent); }
.p .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--muted); }
.p.talk .n, .p.me .n { color: var(--text); font-weight: 600; }
.p .i { color: #f23f43; display: flex; gap: 2px; }
.p .live { font-size: 9px; font-weight: 800; letter-spacing: .1em; padding: 2px 6px; border-radius: 999px; background: #f23f43; color: #fff; }
body:not(.live).compact .p:not(.talk):not(.me) { display: none; }
.ctl { display: none; gap: 6px; padding-top: 10px; margin-top: 8px; border-top: 1px solid color-mix(in srgb, var(--text) 8%, transparent); } body.live .ctl { display: flex; }
.ctl button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 34px; border: 0; border-radius: calc(var(--radius) * .6); cursor: pointer;
  color: var(--text); font: 600 12px var(--font), system-ui, sans-serif; background: color-mix(in srgb, var(--text) 8%, transparent); transition: background .12s; }
.ctl button:hover { background: color-mix(in srgb, var(--accent) 35%, transparent); }
.ctl button.on { background: #f23f43; color: #fff; }
.ctl button.leave { flex: 0 0 42px; color: #fff; background: #da373c; }
.ctl button.leave:hover { background: #f23f43; }
#toasts { display: flex; flex-direction: column; gap: 8px; }
body[data-corner^="bottom"] #toasts { flex-direction: column-reverse; }
.t { display: flex; gap: 10px; padding: 10px 12px 10px 14px; animation: in .22s ease-out both; cursor: default; }
.t::before { content: ""; position: absolute; inset: 8px auto 8px 0; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
body.live .t { cursor: pointer; } body.live .t:hover { border-color: var(--accent); }
.t img { width: 34px; height: 34px; border-radius: 50%; flex: none; background: color-mix(in srgb, var(--text) 10%, transparent); }
.t .b { min-width: 0; flex: 1; } .t .a { display: flex; align-items: baseline; gap: 6px; font-weight: 700; font-size: 13px; }
.t .w { color: var(--muted); font-size: 11px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.t .time { color: var(--muted); font-size: 10px; font-weight: 500; }
.t .m { margin-top: 2px; font-size: 13px; line-height: 1.35; color: color-mix(in srgb, var(--text) 88%, transparent); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-word; }
.t.out { animation: out .25s ease-in both; }
#hint { display: none; align-items: center; justify-content: center; gap: 6px; padding: 7px; font-size: 11px; color: var(--muted); } body.live #hint { display: flex; }
kbd { padding: 1px 6px; border-radius: 5px; font: 700 10px var(--font), system-ui, sans-serif; color: var(--text); background: color-mix(in srgb, var(--text) 12%, transparent); border-bottom: 2px solid color-mix(in srgb, var(--text) 18%, transparent); }
#empty { display: none; padding: 14px; text-align: center; color: var(--muted); font-size: 13px; } body.live:not(.voice) #empty { display: block; }
@keyframes in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
@keyframes out { to { opacity: 0; transform: scale(.97); } }
</style></head><body data-corner="top-left">
<div id="shade"></div>
<div id="dock">
  <div id="call" class="card">
    <div class="head"><div class="ic">${svg(ICONS.speaker)}</div><div class="tx"><div class="name" id="cname"></div><div class="where" id="gname"></div></div><div class="count" id="count"></div></div>
    <div class="who" id="who"></div>
    <div class="ctl">
      <button id="mute"></button><button id="deaf"></button><button id="open">${svg(ICONS.open)}Open</button><button id="leave" class="leave" title="Leave the call">${svg(ICONS.leave)}</button>
    </div>
  </div>
  <div id="empty" class="card">Not in a call. New messages show up here.</div>
  <div id="toasts"></div>
  <div id="hint" class="card"><kbd id="key">Ctrl + Shift + O</kbd> or <kbd>Esc</kbd> back to your game</div>
</div>
<script>
const $ = id => document.getElementById(id);
const send = a => console.log("dz:" + JSON.stringify(a));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const css = (k, v) => v != null && v !== "" && document.documentElement.style.setProperty(k, String(v));
const ICON = ${JSON.stringify({ mic: svg(ICONS.mic), micOff: svg(ICONS.micOff), headphones: svg(ICONS.headphones), deafOff: svg(ICONS.deafOff) })};
// only https images and plain values from Discord get in: nothing here is ever run as code
const img = u => /^https:\\/\\//.test(u || "") ? esc(u) : "";
let state = {};
let fontLink = null;
window.dz = {
  config(c) {
    document.body.dataset.corner = c.corner || "top-left";
    document.body.classList.toggle("compact", !!c.compact);
    css("--opacity", c.opacity ?? 1);
    if (c.key) $("key").textContent = c.key.replace(/Control/g, "Ctrl").replace(/\\+/g, " + ");
    const t = c.theme || {};
    css("--accent", t.accent || c.accent); css("--panel", t.panel); css("--text", t.text); css("--radius", t.radius); css("--alpha", t.glass ? "74%" : "94%");
    document.body.classList.toggle("glass", !!t.glass);
    if (t.font) css("--font", '"' + String(t.font).replace(/["\\\\]/g, "") + '"');
    if (t.fontHref && /^https:\\/\\/fonts\\.googleapis\\.com\\//.test(t.fontHref)) {
      fontLink ??= document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet" }));
      if (fontLink.href !== t.fontHref) fontLink.href = t.fontHref;
    }
  },
  live(on) { document.body.classList.toggle("live", on); },
  call(s) {
    state = s || {};
    document.body.classList.toggle("voice", !!s);
    if (!s) return;
    $("cname").textContent = s.channel || "Voice";
    $("gname").textContent = s.guild || "Direct call";
    $("count").textContent = s.people.length > 1 ? s.people.length : "";
    $("who").innerHTML = s.people.map(p => '<div class="p' + (p.talk ? " talk" : "") + (p.me ? " me" : "") + '"><img src="' + img(p.avatar) + '"><div class="n">' + esc(p.name) + '</div>' +
      (p.live ? '<span class="live">LIVE</span>' : "") + '<span class="i">' + (p.deaf ? ICON.deafOff : p.mute ? ICON.micOff : "") + '</span></div>').join("");
    $("mute").classList.toggle("on", !!s.selfMute); $("mute").innerHTML = (s.selfMute ? ICON.micOff : ICON.mic) + (s.selfMute ? "Unmute" : "Mute");
    $("deaf").classList.toggle("on", !!s.selfDeaf); $("deaf").innerHTML = (s.selfDeaf ? ICON.deafOff : ICON.headphones) + (s.selfDeaf ? "Undeafen" : "Deafen");
  },
  talk(ids) {
    const set = new Set(ids);
    (state.people || []).forEach((p, i) => { const el = $("who").children[i]; if (el) el.classList.toggle("talk", set.has(p.id)); });
  },
  toast(t) {
    const el = document.createElement("div");
    el.className = "card t";
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    el.innerHTML = '<img src="' + img(t.avatar) + '"><div class="b"><div class="a">' + esc(t.author) + '<span class="w">' + esc(t.where) + '</span><span class="time">' + time + '</span></div><div class="m">' + esc(t.text) + '</div></div>';
    el.onclick = () => send({ a: "open", channel: t.channel, guild: t.guild, message: t.id });
    $("toasts").prepend(el);
    while ($("toasts").children.length > 4) $("toasts").lastChild.remove();
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, t.ms || 7000);
  },
};
$("mute").onclick = () => send({ a: "mute" });
$("deaf").onclick = () => send({ a: "deaf" });
$("leave").onclick = () => send({ a: "leave" });
$("open").onclick = () => send({ a: "open" });
$("shade").onclick = () => send({ a: "close" });
addEventListener("keydown", e => { if (e.key === "Escape") send({ a: "close" }); });
send({ a: "ready" });
</script></body></html>`;
