/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// In-app updater (main process, plain Node): brings the Terono install this Discord runs from to a release,
// the same way Terono Setup does: git for Terono + Vencord, pnpm when Vencord's dependencies changed, then the
// Vencord build. The new build loads when Discord restarts.

import { execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

const REPO = "https://github.com/darkzmaj/Terono";
const API = "https://api.github.com/repos/darkzmaj/Terono/releases/latest";

export interface ReleaseInfo {
    version?: string;
    notes?: string;
    url?: string;
    error?: string;
}

export interface UpdateState {
    running: boolean;
    step: number;
    steps: string[];
    done: boolean;
    error?: string;
    log: string[];
}

export const STEPS = ["Downloading Terono", "Updating Vencord", "Installing packages", "Building"];

const state: UpdateState = { running: false, step: -1, steps: STEPS, done: false, log: [] };

export const getState = (): UpdateState => ({ ...state, log: state.log.slice(-12) });

function log(line: string) {
    for (const l of line.split(/\r?\n/)) if (l.trim()) state.log.push(l.trimEnd());
    if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

function run(file: string, args: string[], cwd: string): Promise<{ code: number; out: string; }> {
    return new Promise(res => {
        log(`$ ${file} ${args.join(" ")}`);
        let out = "";
        const child = spawn(file, args, { cwd, windowsHide: true });
        child.stdout.on("data", d => { out += d; log(String(d)); });
        child.stderr.on("data", d => { log(String(d)); });
        child.on("error", e => { log(e.message); res({ code: -1, out }); });
        child.on("close", code => res({ code: code ?? -1, out }));
    });
}

const git = (cwd: string, ...args: string[]) => run("git", args, cwd);

// npx is a .cmd script on Windows, which only cmd.exe can start
const npx = (cwd: string, args: string) => process.platform === "win32"
    ? run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npx -y ${args}`], cwd)
    : run("npx", ["-y", ...args.split(" ")], cwd);

function quiet(cwd: string, ...args: string[]): Promise<string | null> {
    return new Promise(res => execFile("git", args, { cwd, windowsHide: true }, (err, stdout) => res(err ? null : stdout.trim())));
}

const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const fileHash = (p: string) => existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "";

/* ---------- which installs can update themselves ---------- */

// Installs made by Terono Setup / the install scripts are shallow clones in their own folder. Anything else
// (a developer's full clone, local changes) is left alone: resetting it would throw work away.
export async function canUpdate(root: string): Promise<{ ok: boolean; reason?: string; }> {
    const plugin = join(root, "src", "userplugins", "terono");
    if (!existsSync(join(plugin, ".git"))) return { ok: false, reason: "This Terono wasn't installed with Terono Setup. Update it by running Terono Setup." };

    const top = await quiet(plugin, "rev-parse", "--show-toplevel");
    const origin = await quiet(plugin, "remote", "get-url", "origin");
    if (!top || !same(top, plugin) || origin?.replace(/\.git$/, "") !== REPO)
        return { ok: false, reason: "The Terono folder is damaged. Run Terono Setup to repair it." };

    if (await quiet(plugin, "rev-parse", "--is-shallow-repository") !== "true")
        return { ok: false, reason: "This is a development copy of Terono. Update it with git." };

    if (await quiet(plugin, "status", "--porcelain", "--untracked-files=no"))
        return { ok: false, reason: "The Terono folder has local changes. Run Terono Setup to reset it." };

    return { ok: true };
}

/* ---------- latest release ---------- */

export async function latestRelease(): Promise<ReleaseInfo> {
    try {
        const res = await fetch(API, { headers: { "User-Agent": "Terono-Updater", "Accept": "application/vnd.github+json" } });
        if (!res.ok) return { error: `GitHub answered ${res.status}` };
        const data = await res.json() as { tag_name?: string; body?: string; html_url?: string; };
        const version = data.tag_name?.replace(/^v/, "");
        if (!version || !/^\d+(\.\d+){2,3}$/.test(version)) return { error: "No valid release found" };
        return { version, notes: (data.body ?? "").slice(0, 2000), url: data.html_url };
    } catch (e) {
        return { error: `Couldn't reach GitHub (${(e as Error).message})` };
    }
}

/* ---------- the update ---------- */

export function startUpdate(root: string, version: string): { ok: boolean; error?: string; } {
    if (state.running) return { ok: true };
    if (!/^\d+(\.\d+){2,3}$/.test(version)) return { ok: false, error: "Invalid version" };

    Object.assign(state, { running: true, step: 0, done: false, error: undefined, log: [] });
    update(root, `v${version}`).then(
        () => Object.assign(state, { running: false, done: true, step: STEPS.length }),
        (e: Error) => { log(e.message); Object.assign(state, { running: false, error: e.message }); }
    );
    return { ok: true };
}

async function update(root: string, tag: string) {
    const plugin = join(root, "src", "userplugins", "terono");

    const check = await canUpdate(root);
    if (!check.ok) throw new Error(check.reason);

    // 1. Terono: exactly the released version
    state.step = 0;
    if ((await git(plugin, "fetch", "--depth", "1", "origin", "tag", tag, "--no-tags")).code !== 0)
        throw new Error(`Couldn't download Terono ${tag}. Check your internet connection and try again.`);
    if ((await git(plugin, "reset", "--hard", tag)).code !== 0)
        throw new Error("Couldn't switch to the new Terono version. Run Terono Setup to repair it.");

    // 2. Vencord: newest, like Terono Setup (only for installs Terono Setup made: shallow and unchanged)
    state.step = 1;
    const lock = join(root, "pnpm-lock.yaml");
    const lockBefore = fileHash(lock);
    const vencordOwn = await quiet(root, "rev-parse", "--is-shallow-repository") === "true"
        && !await quiet(root, "status", "--porcelain", "--untracked-files=no");
    if (vencordOwn) {
        if ((await git(root, "fetch", "--depth", "1", "origin", "main")).code !== 0 || (await git(root, "reset", "--hard", "FETCH_HEAD")).code !== 0)
            throw new Error("Couldn't update Vencord. Check your internet connection and try again.");
    } else log("Vencord folder isn't a Terono Setup install, left as it is.");

    // 3. dependencies, only when Vencord's changed
    state.step = 2;
    if (fileHash(lock) !== lockBefore || !existsSync(join(root, "node_modules"))) {
        const pm = /"packageManager"\s*:\s*"(pnpm@[\w.+-]+)"/.exec(readFileSync(join(root, "package.json"), "utf8"))?.[1] ?? "pnpm";
        if ((await npx(root, `${pm} install --frozen-lockfile`)).code !== 0)
            throw new Error("Installing packages failed. Try again, or run Terono Setup.");
    } else log("Packages are up to date.");

    // 4. build (what Vencord's own updater runs)
    state.step = 3;
    if ((await run("node", ["scripts/build/build.mjs"], root)).code !== 0)
        throw new Error("Building failed. Try again, or run Terono Setup.");
}
