/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, GuildMemberStore, GuildStore, NavigationRouter, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { settings } from "./settings";

/* ================= Terono overlay: the Discord side =================
   Sends the overlay window (native.ts / overlayPage.ts) the call you're in, who's talking, and DMs and mentions,
   and does what its buttons ask. Only while the overlay is on; talking updates are batched per frame. */

const Native = () => VencordNative.pluginHelpers.Terono as PluginNative<typeof import("./native")>;
const VoiceActions = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");
const ChannelActions = findByPropsLazy("selectVoiceChannel", "selectChannel");
const MediaEngineStore = findStoreLazy("MediaEngineStore") as { isSelfMute(): boolean; isSelfDeaf(): boolean; };
const Streams = findByPropsLazy("getAllApplicationStreams", "getActiveStreamForApplicationStream");

const talking = new Set<string>();
let callTimer = 0;
let talkFrame = 0;
let running = false;

const on = () => IS_DISCORD_DESKTOP && (settings.store.overlayShow ?? "on") !== "off";

function nameOf(userId: string, guildId?: string | null) {
    const u = UserStore.getUser(userId);
    return (guildId && GuildMemberStore.getNick(guildId, userId)) || (u as any)?.globalName || u?.username || "Someone";
}

function avatarOf(userId: string, guildId?: string | null) {
    try { return UserStore.getUser(userId)?.getAvatarURL(guildId ?? undefined, 64, false) ?? ""; } catch { return ""; }
}

function pushCall() {
    callTimer = 0;
    if (!running) return;
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const channel = channelId && ChannelStore.getChannel(channelId);
    if (!channel) { Native().overlayCall(null); return; }
    const guildId = channel.guild_id;
    const me = UserStore.getCurrentUser()?.id;
    let live = new Set<string>();
    try { live = new Set(Streams.getAllApplicationStreams().filter((s: any) => s.channelId === channelId).map((s: any) => s.ownerId)); } catch { }
    const states = Object.values(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}) as any[];
    const people = states.map(v => ({
        id: v.userId,
        name: nameOf(v.userId, guildId),
        avatar: avatarOf(v.userId, guildId),
        mute: v.selfMute || v.mute,
        deaf: v.selfDeaf || v.deaf,
        live: live.has(v.userId),
        talk: talking.has(v.userId),
        me: v.userId === me,
    })).sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
    Native().overlayCall({
        channel: channel.name || "Call",
        guild: guildId ? GuildStore.getGuild(guildId)?.name ?? "" : "",
        people,
        selfMute: MediaEngineStore.isSelfMute(),
        selfDeaf: MediaEngineStore.isSelfDeaf(),
    });
}

const scheduleCall = () => { if (running && !callTimer) callTimer = window.setTimeout(pushCall, 120); };

function onSpeaking({ userId, speakingFlags, context }: { userId: string; speakingFlags: number; context?: string; }) {
    if (context && context !== "default") return;
    const was = talking.has(userId);
    if (speakingFlags) talking.add(userId); else talking.delete(userId);
    if (was === !!speakingFlags || talkFrame) return;
    talkFrame = requestAnimationFrame(() => { talkFrame = 0; Native().overlayTalk([...talking]); });
}

function onVoiceChannelSelect() {
    talking.clear();
    scheduleCall();
}

/* ---------- DMs and mentions ---------- */

function textOf(m: any) {
    let t = String(m.content ?? "").replace(/<@!?(\d+)>/g, (_, id) => "@" + nameOf(id)).replace(/<#(\d+)>/g, (_, id) => "#" + (ChannelStore.getChannel(id)?.name ?? "channel")).replace(/<a?:(\w+):\d+>/g, ":$1:");
    if (!t && m.attachments?.length) t = "📎 " + (m.attachments.length > 1 ? `${m.attachments.length} files` : m.attachments[0].filename ?? "a file");
    if (!t && m.embeds?.length) t = "sent a link";
    if (!t && m.sticker_items?.length) t = "sent a sticker";
    return t.slice(0, 220);
}

function onMessage({ message, optimistic }: { message: any; optimistic?: boolean; }) {
    if (optimistic || !settings.store.overlayToasts || (settings.store.overlayShow ?? "on") !== "on") return;
    const me = UserStore.getCurrentUser()?.id;
    if (!message?.author || message.author.id === me) return;
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) return;
    const dm = channel.isDM?.() || channel.isGroupDM?.();
    const mentioned = message.mentions?.some((u: any) => (u.id ?? u) === me);
    if (!dm && !mentioned) return;
    // you're looking at it already
    if (document.hasFocus() && SelectedChannelStore.getChannelId() === channel.id) return;
    const guildId = channel.guild_id;
    Native().overlayToast({
        id: message.id,
        channel: channel.id,
        guild: guildId ?? null,
        author: nameOf(message.author.id, guildId),
        avatar: avatarOf(message.author.id, guildId),
        where: channel.isDM?.() ? "" : channel.isGroupDM?.() ? channel.name || "Group" : `#${channel.name} · ${GuildStore.getGuild(guildId)?.name ?? ""}`,
        text: textOf(message),
    });
}

/* ---------- what the overlay's buttons ask for ---------- */

export function overlayAction(a: { a: string; channel?: string; guild?: string | null; message?: string; }) {
    switch (a.a) {
        case "mute": VoiceActions.toggleSelfMute(); break;
        case "deaf": VoiceActions.toggleSelfDeaf(); break;
        case "leave": ChannelActions.selectVoiceChannel(null); break;
        case "open": {
            const channel = a.channel ?? SelectedChannelStore.getVoiceChannelId();
            if (!channel) break;
            const guild = a.guild ?? ChannelStore.getChannel(channel)?.guild_id ?? "@me";
            NavigationRouter.transitionTo(`/channels/${guild}/${channel}${a.message ? "/" + a.message : ""}`);
            break;
        }
    }
    scheduleCall();
}

const EVENTS: Record<string, (e: any) => void> = {
    SPEAKING: onSpeaking,
    VOICE_CHANNEL_SELECT: onVoiceChannelSelect,
    VOICE_STATE_UPDATES: scheduleCall,
    AUDIO_TOGGLE_SELF_MUTE: scheduleCall,
    AUDIO_TOGGLE_SELF_DEAF: scheduleCall,
    STREAM_CREATE: scheduleCall,
    STREAM_DELETE: scheduleCall,
    RTC_CONNECTION_STATE: scheduleCall,
    MESSAGE_CREATE: onMessage,
};

/** Starts or stops following Discord, whichever the overlay setting says. */
export function syncOverlay() {
    const want = on();
    if (want === running) return;
    running = want;
    for (const [type, fn] of Object.entries(EVENTS)) {
        if (want) FluxDispatcher.subscribe(type, fn);
        else FluxDispatcher.unsubscribe(type, fn);
    }
    talking.clear();
    if (want) scheduleCall();
}

export function stopOverlay() {
    if (running) {
        running = true;
        for (const [type, fn] of Object.entries(EVENTS)) FluxDispatcher.unsubscribe(type, fn);
        running = false;
    }
    clearTimeout(callTimer);
    callTimer = 0;
    if (IS_DISCORD_DESKTOP) Native().overlayConfig({ key: "", show: "off", corner: "top-left", opacity: 1, accent: "", compact: false }).catch(() => { });
}
