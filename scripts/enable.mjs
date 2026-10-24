/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turns on the Terono plugin and adds the Terono theme link in Vencord's settings.
// Run while Discord is closed (Discord rewrites the file on exit otherwise).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const THEME_LINK = "https://cdn.jsdelivr.net/gh/darkzmaj/Terono@main/theme/Terono.theme.css";

function settingsDir() {
    if (process.env.TERONO_SETTINGS_DIR) return process.env.TERONO_SETTINGS_DIR;
    if (platform() === "win32") return join(process.env.APPDATA, "Vencord", "settings");
    if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Vencord", "settings");
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Vencord", "settings");
}

const dir = settingsDir();
const file = join(dir, "settings.json");
mkdirSync(dir, { recursive: true });

let settings = {};
if (existsSync(file)) {
    copyFileSync(file, file + ".bak");
    settings = JSON.parse(readFileSync(file, "utf8"));
}

settings.plugins ??= {};
settings.plugins.Terono = { ...settings.plugins.Terono, enabled: true };

settings.themeLinks ??= [];
// any Terono link counts (the plugin pins it to its own release version when it starts)
const TERONO_LINK = /^https:\/\/cdn\.jsdelivr\.net\/gh\/(?:Terona-Studios|darkzmaj)\/Terono@[\w.-]+\/theme\/Terono\.theme\.css$/;
if (!settings.themeLinks.some(l => TERONO_LINK.test(l))) settings.themeLinks.push(THEME_LINK);

// the theme is included now; an old local copy would load it twice
if (Array.isArray(settings.enabledThemes))
    settings.enabledThemes = settings.enabledThemes.filter(t => !/^(terono|darkness)\.theme\.css$/i.test(t));

writeFileSync(file, JSON.stringify(settings, null, 4));
console.log(`Terono enabled and theme added (${file})`);
