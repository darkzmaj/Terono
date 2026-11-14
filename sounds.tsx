/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { wreq } from "@webpack";
import { useEffect, useState } from "@webpack/common";

import { toast } from "./toast";

/* ================= your own sounds =================
   Discord finds every sound through one table, sound file name -> module -> file address ("/assets/….mp3"), and
   reads the address each time it plays a sound. Pointing an entry at your own file (kept on this PC, never
   uploaded) makes Discord play yours wherever that sound plays: the ringtone, messages, joins, mute… Discord's
   sound packs use their own names for some sounds (bop_message1, call_ringing_beat…), so every variant of a sound
   is pointed at your file. Removing it puts Discord's back. */

export const SOUNDS: [key: string, label: string, note: string][] = [
    ["call_ringing", "Someone is calling you", "The ringtone of an incoming call."],
    ["call_calling", "You're calling someone", "While your call rings on their side."],
    ["message1", "New message", "Message and mention notifications."],
    ["user_join", "Someone joins your call", ""],
    ["user_leave", "Someone leaves your call", ""],
    ["user_moved", "You were moved", "Moved to another voice channel."],
    ["mute", "Mute", ""],
    ["unmute", "Unmute", ""],
    ["deafen", "Deafen", ""],
    ["undeafen", "Undeafen", ""],
    ["disconnect", "Disconnected", "You left or lost the call."],
    ["ptt_start", "Push to talk on", ""],
    ["ptt_stop", "Push to talk off", ""],
    ["stream_started", "Stream started", "Someone (or you) went live."],
    ["stream_ended", "Stream ended", ""],
    ["stream_user_joined", "Someone watches your stream", ""],
    ["stream_user_left", "Someone stops watching", ""],
];

const KEY = (k: string) => `Terono_sound_${k}`;
const TYPES = ["audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/mp4", "audio/aac", "audio/flac"];
const MAX = 8 * 1024 * 1024;

let table: Map<string, string> | null = null; // sound file name -> module id
const originals = new Map<string, unknown>(); // module id -> Discord's address
const urls = new Map<string, string>(); // sound key -> blob URL

function soundTable() {
    if (table) return table;
    table = new Map();
    for (const id in wreq.m) {
        const src = String(wreq.m[id]);
        if (!src.includes('"./call_ringing.mp3"')) continue;
        for (const m of src.matchAll(/"\.\/([\w-]+)\.mp3":"?(\d+)"?/g)) table.set(m[1], m[2]);
        break;
    }
    return table;
}

// call_ringing covers call_ringing_beat etc.; message1 covers bop_message1 etc.
const variantsOf = (key: string) => [...soundTable().keys()].filter(n => n === key || n.startsWith(`${key}_`) || n.endsWith(`_${key}`));

function point(key: string, url: string | null) {
    for (const name of variantsOf(key)) {
        const id = soundTable().get(name)!;
        try { wreq(id as any); } catch { continue; }
        const mod = wreq.c[id as any];
        if (!mod) continue;
        if (!originals.has(id)) originals.set(id, mod.exports);
        mod.exports = url ?? originals.get(id);
    }
}

export async function applySounds() {
    for (const [key] of SOUNDS) {
        const blob = await DataStore.get<Blob>(KEY(key));
        const old = urls.get(key);
        if (blob instanceof Blob) {
            if (!old) urls.set(key, URL.createObjectURL(blob));
            point(key, urls.get(key)!);
        } else if (old) {
            point(key, null);
            URL.revokeObjectURL(old);
            urls.delete(key);
        }
    }
}

export function removeSounds() {
    for (const [key, url] of urls) { point(key, null); URL.revokeObjectURL(url); }
    urls.clear();
}

async function setSound(key: string, file: File | null) {
    if (file) {
        if (!TYPES.includes(file.type) && !/\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i.test(file.name)) return toast("Use an MP3, OGG, WAV, M4A, AAC or FLAC file.", "failure");
        if (file.size > MAX) return toast("Sounds must be 8 MB or smaller.", "failure");
        await DataStore.set(KEY(key), file);
    } else await DataStore.del(KEY(key));
    const old = urls.get(key);
    if (old) { URL.revokeObjectURL(old); urls.delete(key); }
    await applySounds();
    toast(file ? "Sound changed." : "Discord's sound is back.", "success");
}

function play(key: string) {
    const url = urls.get(key) ?? (() => { const name = variantsOf(key)[0]; const id = name && soundTable().get(name); return id ? String(originals.get(id) ?? wreq(id as any)) : null; })();
    if (url) new Audio(url).play().catch(() => { });
}

/** Settings → Calls & overlay → Sounds */
export function SoundsPanel() {
    const [have, setHave] = useState<Record<string, boolean>>({});
    const refresh = async () => setHave(Object.fromEntries(await Promise.all(SOUNDS.map(async ([k]) => [k, (await DataStore.get(KEY(k))) instanceof Blob] as const))));
    useEffect(() => { void refresh(); }, []);
    return (
        <div className="dz-sounds">
            <p className="dz-look-note">Your own sound files instead of Discord's, kept only on this PC. Discord plays them wherever that sound plays.</p>
            {SOUNDS.map(([key, label, note]) => (
                <div key={key} className="dz-sound">
                    <div className="dz-sound-text"><b>{label}</b>{note && <small>{note}</small>}</div>
                    <span className={`dz-sound-state${have[key] ? " dz-on" : ""}`}>{have[key] ? "Yours" : "Discord's"}</span>
                    <Button size="small" variant="secondary" onClick={() => play(key)}>Play</Button>
                    <label className="dz-file-btn">{have[key] ? "Change" : "Choose file"}
                        <input type="file" accept="audio/*" onChange={async e => { const f = e.currentTarget.files?.[0]; if (f) { await setSound(key, f); void refresh(); } }} />
                    </label>
                    {have[key] && <Button size="small" variant="secondary" onClick={async () => { await setSound(key, null); void refresh(); }}>Reset</Button>}
                </div>
            ))}
        </div>
    );
}

export const SOUNDS_CSS = `
.dz-sounds { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; }
.dz-sound { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 0; border-top: 1px solid color-mix(in srgb, var(--dz-text, #f1f2f4) 6%, transparent); }
.dz-sound-text { flex: 1 1 200px; display: flex; flex-direction: column; color: var(--text-default, #fff); font-size: 14px; }
.dz-sound-text small { color: var(--text-muted, #aaa); font-size: 12px; }
.dz-sound-state { font-size: 12px; color: var(--text-muted, #aaa); }
.dz-sound-state.dz-on { color: var(--dz-accent, #429cff); font-weight: 600; }
`;
