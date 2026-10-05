/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Terono badge server (server/ in this repo, a Cloudflare Worker) and the Discord app used to sign in to it.
// Shared by the plugin and native.ts (which allows the server in Discord's content security policy).
export const BADGE_API = "https://terono-badges.teronastudios.workers.dev";
export const BADGE_CLIENT_ID = "1553751124475908136";
// the only account that can read the user count (/stats checks this on the server too)
export const OWNER_ID = "1364930123656335402";
export const badgesReady = () => !BADGE_API.includes("REPLACE") && !BADGE_CLIENT_ID.includes("REPLACE");
