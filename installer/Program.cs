// Terono Setup: installs or updates the Terono theme + plugin for Discord.
//
// It does exactly what the manual install in the README does, step by step, with the normal tools:
//   git (download Vencord + Terono) -> pnpm (build) -> Vencord's installer (put it into Discord) -> enable Terono.
// Nothing is downloaded and executed as a script, and nothing runs hidden. Every command is printed and logged
// to %TEMP%\Terono-Setup.log.

using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using TeronoTools;

namespace TeronoSetup;

internal static class Program
{
    private const string VencordRepo = "https://github.com/Vendicated/Vencord";
    private const string TeronoRepo = "https://github.com/darkzmaj/Terono";

    // Private copies of Git and Node.js for PCs without them (or with a Node older than Vencord needs). Checked
    // against the SHA-256 Git for Windows and Node.js publish for these files.
    private const string GitZip = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/MinGit-2.47.1-64-bit.zip";
    private const string GitSha = "50b04b55425b5c465d076cdb184f63a0cd0f86f6ec8bb4d5860114a713d2c29a";
    private const string NodeZip = "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip";
    private const string NodeSha = "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541";
    // the oldest Node.js Vencord's build tool (pnpm 11) runs on; an older one on the PC gets the private copy
    private static readonly Version MinNode = new(22, 13);

    private static StreamWriter _log;

    private sealed class SetupException(string message) : Exception(message);

    private static int Main()
    {
        Console.Title = "Terono Setup";

        // double-clicking twice would run two installs into the same folder at once
        using var single = new Mutex(true, "Local\\TeronoSetup", out var first);
        if (!first)
        {
            Console.WriteLine("Terono Setup is already running in another window.");
            return Finish(1);
        }

        var logPath = Path.Combine(Path.GetTempPath(), "Terono-Setup.log");
        try { _log = new StreamWriter(logPath, false) { AutoFlush = true }; } catch { /* logging is optional */ }

        Header();
        try
        {
            Install();
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine();
            Console.WriteLine("Terono is installed. Open Discord > Settings > Vencord > Plugins > Terono to customize it.");
            Console.ResetColor();
            return Finish(0);
        }
        catch (SetupException e)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine(e.Message);
            Console.ResetColor();
            Console.WriteLine($"Details: {logPath}");
            Log("FAILED: " + e.Message);
            return Finish(1);
        }
    }

    private static void Header()
    {
        var version = typeof(Program).Assembly.GetName().Version;
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine($"Terono Setup {version.Major}.{version.Minor}.{version.Build}  |  darkzmaj.eu");
        Console.ResetColor();
        Console.WriteLine("Installs or updates the Terono theme and plugin. Discord closes and reopens at the end.");
        Log($"Terono Setup {version} on {Environment.OSVersion}");
    }

    private static void Install()
    {
        var dir = Environment.GetEnvironmentVariable("TERONO_DIR");
        if (string.IsNullOrWhiteSpace(dir)) dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Terono");
        var vencord = Path.Combine(dir, "Vencord");
        var plugin = Path.Combine(vencord, "src", "userplugins", "terono");

        Directory.CreateDirectory(dir);
        var tools = Path.Combine(dir, "tools");
        EnsureTool("Git", Path.Combine(tools, "git"), "cmd", GitZip, GitSha, () => Exec("where", "git", null, quiet: true) == 0);
        EnsureTool("Node.js", Path.Combine(tools, "node"), "", NodeZip, NodeSha, () => NodeVersion() >= MinNode);

        Step("Getting Vencord");
        Sync(VencordRepo, vencord);

        Step("Getting Terono");
        Sync(TeronoRepo, plugin);

        var pnpm = PackageManager(vencord);

        Step("Installing build tools (the first run takes a minute)");
        if (Npx($"{pnpm} install --frozen-lockfile", vencord) != 0 && Npx($"{pnpm} install --frozen-lockfile", vencord) != 0)
            throw new SetupException("Installing the build tools failed. Check your internet connection and run Terono Setup again.");

        Step("Building");
        if (Npx($"{pnpm} build", vencord) != 0)
            throw new SetupException("Building failed. Run Terono Setup again; if it keeps failing, send the log file below to darkzmaj (darkzmaj.eu).");

        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("TERONO_NO_INJECT")))
        {
            Step("Build finished (TERONO_NO_INJECT is set, Discord left untouched)");
            return;
        }

        Step("Closing Discord");
        CloseDiscord();

        Step("Installing into Discord");
        // Vencord's installer reports problems only in its own output (its exit code is always 0), so look at the result
        Exec("node", "scripts/runInstaller.mjs -- --install --branch auto", vencord);
        var patcher = Path.Combine(vencord, "dist", "patcher.js");
        var patched = new System.Collections.Generic.List<DiscordInstall>();
        foreach (var d in DiscordKit.Find())
        {
            var state = DiscordKit.State(d, out _);
            Log($"{d.Name}: {state}");
            if (state != PatchState.Patched && state != PatchState.Guarded) continue;
            DiscordKit.WriteGuard(d, patcher);
            patched.Add(d);
        }
        if (patched.Count == 0)
            throw new SetupException("Installing into Discord failed. Make sure Discord is installed (and has been opened once), then run Terono Setup again. If it keeps failing, run Terono Diagnostics.");

        Step("Turning on Terono");
        if (Exec("node", Quote(Path.Combine(plugin, "scripts", "enable.mjs")), vencord) != 0)
            throw new SetupException("Turning on Terono failed. Run Terono Setup again.");

        // Never leave Discord unable to open: start it, and if it doesn't come up, put plain Discord back
        Step("Opening Discord to check that it works");
        var main = patched[0];
        if (DiscordKit.Launch(main, 75, out var note)) { Log(note); return; }

        Warn($"Discord didn't open properly with Terono ({note}). Putting plain Discord back so it works.");
        DiscordKit.Kill(main);
        DiscordKit.Unpatch(main);
        var back = DiscordKit.Launch(main, 60, out var backNote);
        Log($"plain Discord: {backNote}");
        throw new SetupException(back
            ? "Terono couldn't be started safely, so Discord was left as it was (it opens normally). Run Terono Diagnostics and send its report to darkzmaj (darkzmaj.eu)."
            : "Discord doesn't open, even without Terono. Run Terono Diagnostics: it repairs Discord and makes a report for darkzmaj (darkzmaj.eu).");
    }

    /* ---------- steps ---------- */

    // Existing download: fetch the newest version and reset to it (local changes and half-finished updates can't
    // block it). Missing or broken folder: download it fresh.
    private static void Sync(string url, string path)
    {
        // The Terono folder sits inside the Vencord download. If its own .git is damaged, git silently walks up and
        // uses Vencord's instead, so only trust a folder that is its own repository root with the expected source.
        if (Directory.Exists(Path.Combine(path, ".git")))
        {
            var top = GitOut(path, "rev-parse --show-toplevel");
            var origin = GitOut(path, "remote get-url origin");
            if (top != null && SamePath(top, path) && origin != null && SameRepo(origin, url)
                && Git(path, "fetch --depth 1 origin main") == 0 && Git(path, "reset --hard FETCH_HEAD") == 0)
                return;
            Warn("The download folder is damaged, downloading it again.");
        }

        if (Directory.Exists(path)) DeleteFolder(path);
        if (Exec("git", $"clone --depth 1 {url} {Quote(path)}", null) != 0)
            throw new SetupException($"Downloading {url} failed. Check your internet connection and run Terono Setup again.");
    }

    private static string PackageManager(string vencord)
    {
        var json = File.ReadAllText(Path.Combine(vencord, "package.json"));
        var m = Regex.Match(json, "\"packageManager\"\\s*:\\s*\"(pnpm@[0-9A-Za-z.+-]+)\"");
        return m.Success ? m.Groups[1].Value : "pnpm";
    }

    private static void CloseDiscord()
    {
        foreach (var p in Process.GetProcessesByName("Discord"))
        {
            try { p.Kill(); p.WaitForExit(5000); } catch { /* already closed */ }
            finally { p.Dispose(); }
        }
        Thread.Sleep(1500);
    }

    // Git / Node.js: the PC's own when it has a good one, otherwise a private copy in Terono's folder (tools\git,
    // tools\node), which needs no admin rights and no winget (missing or broken on many PCs, which made Setup stop
    // with "git is needed"). The in-app updater uses the same copies.
    private static void EnsureTool(string name, string folder, string binSub, string url, string sha, Func<bool> systemOk)
    {
        var bin = Path.Combine(folder, binSub);
        if (Directory.Exists(bin) && Directory.GetFiles(bin, "*.exe").Length > 0) { UsePath(bin); return; }
        if (systemOk()) return;

        Step($"Downloading {name} for Terono (needed once)");
        var zip = Path.Combine(Path.GetTempPath(), $"terono-{Path.GetFileName(folder)}.zip");
        var unpacked = folder + ".new";
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            using (var web = new WebClient()) web.DownloadFile(url, zip);
            string hash;
            using (var f = File.OpenRead(zip)) using (var h = SHA256.Create()) hash = BitConverter.ToString(h.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
            if (hash != sha) throw new SetupException($"The {name} download was damaged. Run Terono Setup again.");

            if (Directory.Exists(unpacked)) DeleteFolder(unpacked);
            ZipFile.ExtractToDirectory(zip, unpacked);
            // Node.js comes inside one folder (node-v24...-win-x64): its contents become tools\node
            var inner = Directory.GetDirectories(unpacked);
            var top = Directory.GetFiles(unpacked).Length == 0 && inner.Length == 1 ? inner[0] : unpacked;
            if (Directory.Exists(folder)) DeleteFolder(folder);
            Directory.Move(top, folder);
        }
        catch (SetupException) { throw; }
        catch (Exception e)
        {
            Log($"{name} download: {e}");
            throw new SetupException($"Downloading {name} failed ({e.Message}). Check your internet connection and run Terono Setup again.");
        }
        finally
        {
            try { File.Delete(zip); } catch { /* temp file */ }
            try { if (Directory.Exists(unpacked)) DeleteFolder(unpacked); } catch { /* temp folder */ }
        }
        if (!Directory.Exists(bin) || Directory.GetFiles(bin, "*.exe").Length == 0)
            throw new SetupException($"{name} couldn't be set up. Run Terono Setup again.");
        UsePath(bin);
    }

    // first on PATH for everything Setup starts (git, node, npx / pnpm and Vencord's scripts)
    private static void UsePath(string dir)
    {
        var path = Environment.GetEnvironmentVariable("Path") ?? "";
        if (!path.StartsWith(dir + ";", StringComparison.OrdinalIgnoreCase)) Environment.SetEnvironmentVariable("Path", dir + ";" + path);
        Log($"using {dir}");
    }

    // the version of the node on PATH, 0.0 when there is none
    private static Version NodeVersion()
    {
        var psi = new ProcessStartInfo("node", "--version") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        try
        {
            using var p = Process.Start(psi);
            var v = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit();
            Log($"node --version -> {v}");
            var m = Regex.Match(v, @"^v(\d+)\.(\d+)");
            return m.Success ? new Version(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value)) : new Version(0, 0);
        }
        catch (Win32Exception) { return new Version(0, 0); }
    }

    /* ---------- helpers ---------- */

    private static int Git(string repo, string args) => Exec("git", $"-C {Quote(repo)} {args}", null);

    // first line of git's output, or null when the command fails
    private static string GitOut(string repo, string args)
    {
        var psi = new ProcessStartInfo("git", $"-C {Quote(repo)} {args}")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        try
        {
            using var p = Process.Start(psi);
            var output = p.StandardOutput.ReadToEnd();
            p.StandardError.ReadToEnd();
            p.WaitForExit();
            Log($"$ git -C {repo} {args}  ->  {(p.ExitCode == 0 ? output.Trim() : "exit " + p.ExitCode)}");
            return p.ExitCode == 0 ? output.Trim() : null;
        }
        catch (Win32Exception) { return null; }
    }

    private static bool SamePath(string a, string b) =>
        string.Equals(Path.GetFullPath(a.Replace('/', '\\')).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);

    private static bool SameRepo(string a, string b)
    {
        static string Norm(string u)
        {
            u = u.Trim().TrimEnd('/').ToLowerInvariant();
            return u.EndsWith(".git") ? u.Substring(0, u.Length - 4) : u;
        }
        return Norm(a) == Norm(b);
    }

    // npx is a .cmd script, which only cmd.exe can start
    private static int Npx(string args, string cwd) => Exec("cmd.exe", $"/d /s /c \"npx -y {args}\"", cwd);

    private static int Exec(string file, string args, string cwd, bool quiet = false, bool wait = true)
    {
        Log($"$ {file} {args}" + (cwd != null ? $"   (in {cwd})" : ""));
        var psi = new ProcessStartInfo(file, args)
        {
            UseShellExecute = false,
            WorkingDirectory = cwd ?? Environment.CurrentDirectory,
            RedirectStandardOutput = quiet,
            RedirectStandardError = quiet,
        };
        try
        {
            using var p = Process.Start(psi);
            if (!wait) return 0;
            if (quiet) { p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd(); }
            p.WaitForExit();
            Log($"  exit {p.ExitCode}");
            return p.ExitCode;
        }
        catch (Win32Exception e)
        {
            Log($"  could not start: {e.Message}");
            return -1;
        }
    }

    private static void DeleteFolder(string path)
    {
        // git marks its object files read-only, which makes a plain delete fail
        foreach (var f in Directory.GetFiles(path, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
        Directory.Delete(path, true);
    }

    private static string Quote(string s) => "\"" + s + "\"";

    private static void Step(string text)
    {
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine();
        Console.WriteLine("> " + text);
        Console.ResetColor();
        Log("> " + text);
    }

    private static void Warn(string text)
    {
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine(text);
        Console.ResetColor();
        Log("! " + text);
    }

    private static void Log(string text)
    {
        try { _log?.WriteLine($"[{DateTime.Now:HH:mm:ss}] {text}"); } catch { /* ignore */ }
    }

    private static int Finish(int code)
    {
        if (!Console.IsInputRedirected)
        {
            Console.WriteLine();
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
        return code;
    }
}
