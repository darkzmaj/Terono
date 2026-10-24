/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { hasAnyVisibleSettings, isPluginEnabled, pluginRequiresRestart, plugins, startDependenciesRecursive, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { Switch } from "@components/Switch";
import { Plugin } from "@utils/types";
import { useMemo, useState } from "@webpack/common";

import { toast } from "./toast";

// Every Vencord plugin in this build, in one place: by category, searchable. Plugins stay separate (Vencord keeps
// them updated); this is a quicker place to switch and set them up.

// the ones that go especially well with Terono
const RECOMMENDED = new Set([
    "Translate", "MessageLogger", "SilentTyping", "PreviewMessage", "MessageClickActions", "CopyFileContents", "BlurNSFW",
    "PinDMs", "CopyUserURLs", "IgnoreActivities", "FakeProfileThemes",
    "ShowHiddenChannels", "MemberCount", "PermissionsViewer", "BetterRoleContext", "BetterRoleDot", "ForceOwnerCrown",
    "ImageZoom", "FixImagesQuality", "BiggerStreamPreview", "VoiceDownload", "CallTimer", "YoutubeAdblock",
    "BetterUploadButton", "AnonymiseFileNames", "AlwaysTrust",
    "BetterSettings", "BetterSessions", "CrashHandler", "LoadingQuotes", "ThemeAttributes", "Experiments",
]);

const CATEGORIES: [string, string[]][] = [
    ["Chat & messages", [
        "AddAttachments", "CharacterCounter", "CopyEmojiMarkdown", "CopyFileContents", "CustomCommands", "DontRoundMyTimestamps",
        "ExpressionCloner", "FakeNitro", "FavoriteEmojiFirst", "FixCodeblockGap", "FullSearchContext", "FullUserInChatbox",
        "GreetStickerPicker", "HideMedia", "iLoveSpam", "ImageLink", "IrcColors", "MentionAvatars", "MessageClickActions",
        "MessageLatency", "MessageLinkEmbeds", "MessageLogger", "MoreQuickReactions", "NoBlockedMessages", "NoMaskedUrlPaste",
        "NoMiddleClickPaste", "NoReplyMention", "NoServerEmojis", "NoTypingAnimation", "NoUnblockToJump", "PreviewMessage",
        "QuickMention", "QuickReply", "ReplyTimestamp", "RevealAllSpoilers", "SendTimestamps", "ShikiCodeblocks",
        "ShowAllMessageButtons", "SilentMessageToggle", "SuperReactionTweaks", "TextReplace", "Translate", "TypingIndicator",
        "TypingTweaks", "Unindent", "UnsuppressEmbeds", "ValidReply", "ValidUser", "ViewRaw", "WhoReacted",
    ]],
    ["Images, GIFs & video", [
        "AlwaysAnimate", "BetterGifAltText", "BetterGifPicker", "BiggerStreamPreview", "CopyStickerLinks", "Dearrow",
        "FixImagesQuality", "FixSpotifyEmbeds", "FixYoutubeEmbeds", "GifPaste", "ImageFilename", "ImageZoom", "NoMosaic",
        "PictureInPicture", "ReverseImageSearch", "StickerPaste", "TenorGifSearch", "VoiceDownload", "VoiceMessages", "YoutubeAdblock",
    ]],
    ["Voice & calls", [
        "CallTimer", "DisableCallIdle", "NotificationVolume", "SecretRingToneEnabler", "StreamerModeOnStream", "UserVoiceShow",
        "VcNarrator", "VoiceChatDoubleClick", "VolumeBooster", "WebScreenShare", "WebScreenShareFixes",
    ]],
    ["People & profiles", [
        "AccountPanelServerProfile", "AlwaysExpandRoles", "ColorSighted", "CopyUserURLs", "Decor", "FakeProfileThemes",
        "FriendInvites", "ImplicitRelationships", "MutualGroupDMs", "NoProfileThemes", "OnePingPerDM", "PinDMs",
        "PlatformIndicators", "RelationshipNotifier", "ReviewDB", "ShowConnections", "ShowMeYourName", "SortFriendRequests",
        "UserMessagesPronouns", "USRBG", "ViewIcons",
    ]],
    ["Servers & roles", [
        "BetterFolders", "BetterRoleContext", "BetterRoleDot", "ForceOwnerCrown", "KeepCurrentChannel", "MemberCount",
        "NewGuildSettings", "NoOnboardingDelay", "OverrideForumDefaults", "PauseInvitesForever", "PermissionFreeWill",
        "PermissionsViewer", "PlainFolderIcon", "ReadAllNotificationsButton", "RoleColorEverywhere", "ServerInfo",
        "ServerListIndicators", "ShowHiddenChannels", "ShowHiddenThings", "ShowTimeoutDuration",
    ]],
    ["Status, activity & music", [
        "AutoDNDWhilePlaying", "CustomIdle", "CustomRPC", "GameActivityToggle", "IgnoreActivities", "MusicRichPresence",
        "SpotifyControls", "SpotifyCrack", "SpotifyShareCommands", "WebRichPresence (arRPC)", "XSOverlay",
    ]],
    ["Privacy & safety", [
        "AlwaysTrust", "AnonymiseFileNames", "BlurNSFW", "ClearURLs", "NoPendingCount", "SilentTyping",
    ]],
    ["Client & tools", [
        "BetterSessions", "BetterSettings", "BetterUploadButton", "ClientTheme", "ConsoleJanitor", "ConsoleShortcuts",
        "CrashHandler", "DevCompanion", "DisableDeepLinks", "Experiments", "F8Break", "LoadingQuotes", "NoDevtoolsWarning",
        "NoF1", "NoSystemBadge", "OpenInApp", "ReactErrorDecoder", "ReplaceGoogleSearch", "StartupTimings", "ThemeAttributes", "UnlockedAvatarZoom",
        "VencordToolbox", "WebContextMenus", "WebKeybinds", "WebPWA",
    ]],
    ["Fun", ["oneko", "petpet"]],
];

const OTHER = "Other";
const CATEGORY_OF = new Map(CATEGORIES.flatMap(([cat, names]) => names.map(n => [n, cat] as const)));

// what can be switched here: not Vencord's own always-on parts, not libraries other plugins use, not Terono itself
const listed = (p: Plugin) => !p.required && !p.hidden && !/API$/.test(p.name) && p.name !== "Terono";

/* ================= switching =================
   Same rules as Vencord's own plugin list: plugins that patch Discord's code only change after a restart (the
   setting flips now, the Updates box offers the restart); the others start or stop right away. */

function toggle(p: Plugin): boolean {
    const settings = Settings.plugins[p.name];
    const was = isPluginEnabled(p.name);

    if (!was) {
        const { restartNeeded, failures } = startDependenciesRecursive(p);
        if (failures.length) {
            toast(`Couldn't turn on what ${p.name} needs: ${failures.join(", ")}`, "failure");
            return was;
        }
        if (restartNeeded) {
            settings.enabled = true;
            return true;
        }
    }

    if (pluginRequiresRestart(p) || (was && !p.started)) {
        settings.enabled = !was;
        return !was;
    }

    const ok = was ? stopPlugin(p) : startPlugin(p);
    if (!ok) {
        settings.enabled = false;
        toast(`${p.name} couldn't be ${was ? "turned off" : "turned on"}. Restart Discord and try again.`, "failure");
        return false;
    }
    settings.enabled = !was;
    return !was;
}

/* ================= list ================= */

export function Row({ plugin }: { plugin: Plugin; }) {
    // shown right away; the plugin catches up in the background (or after the restart)
    const [on, setOn] = useState(() => isPluginEnabled(plugin.name));
    const waiting = on !== !!plugin.started;

    return (
        <div className={`dz-hub-row${on ? " dz-hub-on" : ""}`}>
            <div className="dz-hub-text">
                <div className="dz-hub-name">
                    {plugin.name}
                    {RECOMMENDED.has(plugin.name) && <span className="dz-hub-tag">Recommended</span>}
                    {waiting && <span className="dz-hub-tag dz-hub-tag-restart">Restart to apply</span>}
                </div>
                <div className="dz-hub-desc">{plugin.description}</div>
            </div>
            {hasAnyVisibleSettings(plugin) && (
                <button className="dz-hub-gear" aria-label={`${plugin.name} settings`} onClick={() => openPluginModal(plugin)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1L15 3.2h-4l-.4 2.7a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" /></svg>
                </button>
            )}
            <Switch checked={on} onChange={() => setOn(toggle(plugin))} />
        </div>
    );
}

const FILTERS = ["All", "Recommended", "On", ...CATEGORIES.map(([c]) => c), OTHER];

// the plugins themselves never change while Discord runs
let allCache: Plugin[] | null = null;
export const listedPlugins = () => allCache ??= Object.values(plugins).filter(listed).sort((a, b) => a.name.localeCompare(b.name));

export function PluginHub() {
    const [filter, setFilter] = useState("All");
    const all = listedPlugins();
    const query = "";
    const filters = useMemo(() => FILTERS.filter(f => f === "All" || f === "Recommended" || f === "On" || all.some(p => (CATEGORY_OF.get(p.name) ?? OTHER) === f)), [all]);

    const q = query.trim().toLowerCase();
    const shown = all.filter(p =>
        (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
        && (filter === "All"
            || (filter === "Recommended" ? RECOMMENDED.has(p.name)
                : filter === "On" ? isPluginEnabled(p.name)
                    : (CATEGORY_OF.get(p.name) ?? OTHER) === filter)));

    // grouped by category, recommended ones first in each
    const groups = new Map<string, Plugin[]>();
    for (const [cat] of [...CATEGORIES, [OTHER]]) groups.set(cat as string, []);
    for (const p of shown) groups.get(CATEGORY_OF.get(p.name) ?? OTHER)!.push(p);
    for (const list of groups.values()) list.sort((a, b) => +RECOMMENDED.has(b.name) - +RECOMMENDED.has(a.name));

    return (
        <div className="dz-hub">
            <div className="dz-hub-bar">
                <div className="dz-hub-filters" role="tablist">
                    {filters.map(f => (
                        <button key={f} role="tab" aria-selected={f === filter} className="dz-hub-filter" onClick={() => setFilter(f)}>{f}</button>
                    ))}
                </div>
            </div>
            {[...groups].filter(([, list]) => list.length).map(([cat, list]) => (
                <section key={cat} className="dz-set-group">
                    <h3 className="dz-set-group-title">{cat} <span className="dz-hub-count">{list.length}</span></h3>
                    <div className="dz-hub-list">
                        {list.map(p => <Row key={p.name} plugin={p} />)}
                    </div>
                </section>
            ))}
        </div>
    );
}

/* ================= restart needed =================
   A plugin whose setting doesn't match what's running (turned on but not started, or turned off but still
   running) waits for a restart. Covers changes made here and in Vencord's own plugin list. */

export function pluginsWaitingForRestart() {
    return Object.values(plugins)
        .filter(p => !p.required && !p.isDependency && isPluginEnabled(p.name) !== !!p.started)
        .map(p => p.name)
        .sort();
}
