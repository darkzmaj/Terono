// Terono Diagnostics: checks Discord and Terono, tests that Discord really opens, repairs what it can without
// touching your data (messages, login, servers, your Terono settings), and writes a report to send to darkzmaj.
//
// What it never does: delete Discord's login/session data, read your messages, or send anything anywhere. The report
// is a text file on your Desktop; your Windows user name is replaced in it.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using TeronoTools;

namespace TeronoDiagnostics;

internal static class Program
{
    private static readonly StringBuilder Report = new();
    private static readonly List<string> Problems = new();
    private static readonly List<string> Fixed = new();
    private static readonly List<string> Unfixed = new();

    private static readonly string Home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static readonly string Local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private static readonly string Roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    private static readonly string TeronoDir = Environment.GetEnvironmentVariable("TERONO_DIR") is { Length: > 0 } t ? t : Path.Combine(Home, "Terono");
    private static readonly string Vencord = Path.Combine(TeronoDir, "Vencord");
    private static readonly string Plugin = Path.Combine(Vencord, "src", "userplugins", "terono");
    private static readonly string Dist = Path.Combine(Vencord, "dist");
    private static readonly string VencordSettings = Path.Combine(Roaming, "Vencord", "settings", "settings.json");
    private static readonly string DiscordData = Path.Combine(Roaming, "discord");

    private static int Main()
    {
        Console.Title = "Terono Diagnostics";
        using var single = new Mutex(true, "Local\\TeronoDiagnostics", out var first);
        if (!first) { Console.WriteLine("Terono Diagnostics is already running in another window."); return 1; }

        var version = typeof(Program).Assembly.GetName().Version;
        Say($"Terono Diagnostics {version.Major}.{version.Minor}.{version.Build}  |  darkzmaj.eu", ConsoleColor.Cyan);
        Console.WriteLine("Checks Discord and Terono, repairs what is broken (your data stays), and writes a report.");
        Console.WriteLine("Discord will be closed and opened again a few times. This takes a minute or two.");
        Rep($"Terono Diagnostics {version} at {DateTime.Now:yyyy-MM-dd HH:mm:ss}");

        var reportPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Terono-Diagnostics-Report.txt");
        try
        {
            Run();
        }
        catch (Exception e)
        {
            Rep("DIAGNOSTICS ITSELF FAILED: " + e);
            Say("Something unexpected happened: " + e.Message, ConsoleColor.Red);
        }

        Section("Result");
        Rep(Problems.Count == 0 ? "No problems found." : "Problems found: " + Problems.Count);
        foreach (var f in Fixed) Rep("  FIXED: " + f);
        foreach (var u in Unfixed) Rep("  NOT FIXED: " + u);

        try { File.WriteAllText(reportPath, Scrub(Report.ToString()), Encoding.UTF8); }
        catch { reportPath = Path.Combine(Path.GetTempPath(), "Terono-Diagnostics-Report.txt"); File.WriteAllText(reportPath, Scrub(Report.ToString()), Encoding.UTF8); }

        Console.WriteLine();
        if (Unfixed.Count == 0) Say(Fixed.Count == 0 ? "Everything works." : "Everything was repaired and Discord opens.", ConsoleColor.Green);
        else Say("Some things could not be fixed automatically.", ConsoleColor.Yellow);
        Console.WriteLine("Report: " + reportPath);
        if (Unfixed.Count > 0 || Fixed.Count > 0) Console.WriteLine("Send this file to darkzmaj (darkzmaj.eu) so it can be looked at.");
        try { Process.Start("notepad.exe", Quote(reportPath)); } catch { /* optional */ }
        if (!Console.IsInputRedirected) { Console.WriteLine(); Console.WriteLine("Press Enter to close."); Console.ReadLine(); }
        return Unfixed.Count == 0 ? 0 : 1;
    }

    private static void Run()
    {
        Section("System");
        Rep($"Windows: {Environment.OSVersion.VersionString} ({(Environment.Is64BitOperatingSystem ? "64" : "32")}-bit)");
        Rep($"Admin: {new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent()).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator)}");
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(Local));
            Rep($"Free disk space: {drive.AvailableFreeSpace / 1048576} MB");
            if (drive.AvailableFreeSpace < 300L * 1048576) Problem("Less than 300 MB free on the drive Discord is installed on", null, "free some disk space");
        }
        catch (Exception e) { Rep("disk: " + e.Message); }

        Section("Tools Terono's installer uses");
        foreach (var (cmd, arg) in new[] { ("git", "--version"), ("node", "--version") })
        {
            var v = Capture(cmd, arg);
            Rep($"{cmd}: {v ?? "NOT FOUND"}");
            if (v == null) Problem($"{cmd} is not installed (needed to update Terono)", null, "run Terono Setup, it installs it");
        }

        Section("Terono files");
        CheckTerono();

        Section("Settings");
        CheckSettings();

        Section("Discord installs");
        var installs = DiscordKit.Find();
        if (installs.Count == 0) Problem("Discord is not installed for this Windows user", null, "install Discord from discord.com, then run Terono Setup");
        foreach (var d in installs) Describe(d);

        Section("Test: does Discord open?");
        var main = installs.FirstOrDefault(i => i.Name == "Discord" && i.AppDir != null) ?? installs.FirstOrDefault(i => i.AppDir != null);
        if (main == null) { Rep("Skipped: no working Discord install was found."); TryReinstall(); main = DiscordKit.Find().FirstOrDefault(i => i.AppDir != null); if (main == null) return; }

        // Round 0 repairs the things that are wrong on paper; then Discord is started for real. While it still doesn't
        // open, each round tries the next, bigger repair. Nothing here removes your login or messages.
        Repair(main, 0);
        for (var round = 1; round <= 4; round++)
        {
            var ok = Test(main);
            if (ok) { if (round > 1 || Problems.Count > 0) Rep($"Discord opens after repair round {round - 1}."); break; }
            if (round == 4) { Unfixed.Add("Discord still does not open. See the test lines above."); break; }
            Say($"Discord didn't open. Trying repair {round}...", ConsoleColor.Yellow);
            Repair(main, round);
            main = DiscordKit.Find().FirstOrDefault(i => i.Name == main.Name) ?? main;
        }

        Section("After the test");
        foreach (var p in Process.GetProcessesByName(main.Name)) { Rep($"process {p.ProcessName} pid {p.Id}"); p.Dispose(); }
        CheckTerono(quiet: true);
    }

    /* ---------- checks ---------- */

    private static void CheckTerono(bool quiet = false)
    {
        Rep($"Terono folder: {TeronoDir} ({(Directory.Exists(TeronoDir) ? "exists" : "MISSING")})");
        if (!Directory.Exists(Vencord)) { Rep("Terono is not installed (no Vencord folder). That is fine if you don't use it."); return; }

        var versionFile = Path.Combine(Plugin, "version.ts");
        Rep("Terono plugin version: " + (File.Exists(versionFile) ? Regex.Match(File.ReadAllText(versionFile), "VERSION = \"([^\"]+)\"").Groups[1].Value : "source missing"));
        Rep("Git commit: " + (Capture("git", $"-C {Quote(Plugin)} log --oneline -1") ?? "unknown"));

        string[] need = { "patcher.js", "preload.js", "renderer.js", "renderer.css" };
        foreach (var f in need)
        {
            var path = Path.Combine(Dist, f);
            var len = File.Exists(path) ? new FileInfo(path).Length : -1;
            Rep($"dist\\{f}: {(len < 0 ? "MISSING" : len + " bytes")}");
            if (len < 1000) Problem($"Terono's build file {f} is missing or empty", () => Rebuild(), "rebuild Terono");
        }
        var renderer = Path.Combine(Dist, "renderer.js");
        if (File.Exists(renderer) && new FileInfo(renderer).Length > 1000)
        {
            var hasTerono = File.ReadAllText(renderer).Contains("Terono");
            Rep("renderer.js contains the Terono plugin: " + hasTerono);
            if (!hasTerono) Problem("The build doesn't contain the Terono plugin", () => Rebuild(), "rebuild Terono");
        }
    }

    private static void CheckSettings()
    {
        Rep("Vencord settings: " + VencordSettings);
        if (File.Exists(VencordSettings))
        {
            if (!ValidJson(VencordSettings, out var map))
                Problem("Vencord's settings file is damaged (Discord/Vencord can fail to start because of it)", RepairVencordSettings, "restore it from the backup");
            else
            {
                var plugins = map.TryGetValue("plugins", out var p) ? p as Dictionary<string, object> : null;
                var terono = plugins != null && plugins.TryGetValue("Terono", out var t) ? t as Dictionary<string, object> : null;
                Rep("Terono enabled in settings: " + (terono != null && terono.TryGetValue("enabled", out var e) ? e : "not set"));
                if (terono != null) foreach (var k in new[] { "serverList", "serverListDirection", "taskbarIcon", "shareUsage", "lastVersion" }) if (terono.TryGetValue(k, out var v)) Rep($"  {k} = {v}");
            }
        }
        else Rep("(no Vencord settings yet)");

        var discordSettings = Path.Combine(DiscordData, "settings.json");
        if (File.Exists(discordSettings) && !ValidJson(discordSettings, out _))
            Problem("Discord's own settings file is damaged", () => MoveAside(discordSettings), "move it aside, Discord makes a new one");
        Rep("Discord data folder: " + (Directory.Exists(DiscordData) ? "exists" : "MISSING (Discord was never opened?)"));
    }

    private static void Describe(DiscordInstall d)
    {
        Rep($"{d.Name}: {d.Root}");
        Rep($"  Update.exe: {(File.Exists(d.UpdateExe) ? "ok" : "MISSING")}");
        Rep($"  app folders: {string.Join(", ", Directory.GetDirectories(d.Root, "app-*").Select(Path.GetFileName))}");
        if (d.AppDir == null) { Problem($"{d.Name} has no usable app folder (the install is broken)", TryReinstall, "reinstall Discord with Discord's own installer (your data stays)"); return; }

        var state = DiscordKit.State(d, out var patcher);
        Rep($"  newest: {Path.GetFileName(d.AppDir)}   patch state: {state}");
        if (patcher != null) Rep($"  patcher: {patcher} ({(DiscordKit.PatcherUsable(patcher) ? "ok" : "MISSING OR EMPTY")})");
        switch (state)
        {
            case PatchState.Broken:
                Problem($"{d.Name}: Discord's app file is missing, so it cannot start", TryReinstall, "reinstall Discord with Discord's own installer (your data stays)");
                break;
            case PatchState.Patched:
            case PatchState.Guarded:
                if (!DiscordKit.PatcherUsable(patcher))
                    Problem($"{d.Name}: Terono's files are missing, so Discord cannot open", () => FixMissingPatcher(d, patcher), "rebuild Terono, or put plain Discord back");
                else if (state == PatchState.Patched)
                    Problem($"{d.Name}: not protected against missing Terono files", () => { DiscordKit.WriteGuard(d, patcher); return true; }, "add the safety guard", fixOnly: true);
                break;
        }
    }

    /* ---------- the test ---------- */

    private static bool Test(DiscordInstall d)
    {
        DiscordKit.Kill(d);
        Say("Starting Discord...", ConsoleColor.Cyan);
        var ok = DiscordKit.Launch(d, 75, out var note);
        Rep($"Test: {(ok ? "PASS" : "FAIL")} ({note})");
        if (!ok) Problems.Add("Discord did not open: " + note);
        return ok;
    }

    /* ---------- repairs ---------- */

    // round 0: every problem found above; later rounds: bigger steps, stopping at the first that makes Discord open
    private static void Repair(DiscordInstall d, int round)
    {
        if (round == 0)
        {
            foreach (var p in PendingFixes.ToList())
            {
                Say("Fixing: " + p.Text, ConsoleColor.Yellow);
                bool ok;
                try { ok = p.Fix(); } catch (Exception e) { Rep("  fix failed: " + e.Message); ok = false; }
                (ok ? Fixed : Unfixed).Add($"{p.Text} -> {p.Action}");
            }
            PendingFixes.Clear();
            return;
        }

        DiscordKit.Kill(d);
        switch (round)
        {
            case 1:
                if (ClearCaches()) Fixed.Add("Cleared Discord's caches (they rebuild by themselves; login and messages are untouched)");
                break;
            case 2:
                if (Rebuild() && DiscordKit.State(d, out var pp) is PatchState.Patched or PatchState.Guarded) { DiscordKit.WriteGuard(d, pp ?? Path.Combine(Dist, "patcher.js")); Fixed.Add("Rebuilt Terono and re-checked the install"); }
                else Rep("Round 2: nothing to rebuild.");
                break;
            case 3:
                if (DiscordKit.State(d, out _) is PatchState.Patched or PatchState.Guarded && DiscordKit.Unpatch(d))
                {
                    Fixed.Add("Terono was taken out of Discord so Discord opens normally. Run Terono Setup again later; this report shows why it failed.");
                    Unfixed.Add("Terono itself had to be removed from Discord to get it to open (send this report)");
                }
                else if (DiscordKit.State(d, out _) == PatchState.Stock) TryReinstall();
                break;
        }
    }

    private sealed class Pending { public string Text, Action; public Func<bool> Fix; }
    private static readonly List<Pending> PendingFixes = new();

    private static void Problem(string text, Func<bool> fix, string action, bool fixOnly = false)
    {
        if (!fixOnly) Problems.Add(text);
        Rep($"PROBLEM: {text}" + (fix != null ? $"  (will: {action})" : $"  ({action})"));
        if (fix != null) PendingFixes.Add(new Pending { Text = text, Action = action, Fix = fix });
        else Unfixed.Add($"{text} ({action})");
    }

    private static bool FixMissingPatcher(DiscordInstall d, string patcher)
    {
        if (Directory.Exists(Vencord) && Rebuild() && DiscordKit.PatcherUsable(patcher)) return true;
        return DiscordKit.Unpatch(d); // plain Discord works; Terono can be installed again
    }

    private static bool Rebuild()
    {
        if (!Directory.Exists(Vencord) || Capture("node", "--version") == null) return false;
        Say("Rebuilding Terono (a minute)...", ConsoleColor.Yellow);
        var json = File.ReadAllText(Path.Combine(Vencord, "package.json"));
        var pnpm = Regex.Match(json, "\"packageManager\"\\s*:\\s*\"(pnpm@[0-9A-Za-z.+-]+)\"") is { Success: true } m ? m.Groups[1].Value : "pnpm";
        var a = Run("cmd.exe", $"/d /s /c \"npx -y {pnpm} install --frozen-lockfile\"", Vencord);
        var b = a == 0 && Run("cmd.exe", $"/d /s /c \"npx -y {pnpm} build\"", Vencord) == 0;
        Rep($"Rebuild: {(b ? "ok" : "failed")}");
        return b;
    }

    private static bool RepairVencordSettings()
    {
        var bak = VencordSettings + ".bak";
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        File.Copy(VencordSettings, VencordSettings + ".damaged-" + stamp, true); // kept, never deleted
        if (File.Exists(bak) && ValidJson(bak, out _)) { File.Copy(bak, VencordSettings, true); return true; }
        File.WriteAllText(VencordSettings, "{}"); // Vencord starts with defaults; the damaged copy is next to it
        return true;
    }

    private static bool MoveAside(string file)
    {
        File.Move(file, file + ".damaged-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        return true;
    }

    // only caches Discord rebuilds by itself: never Local Storage, IndexedDB or Session Storage (those hold your login)
    private static bool ClearCaches()
    {
        var any = false;
        foreach (var name in new[] { "Cache", "Code Cache", "GPUCache", "DawnCache", "GrShaderCache", "ShaderCache" })
        {
            var dir = Path.Combine(DiscordData, name);
            if (!Directory.Exists(dir)) continue;
            try { Directory.Delete(dir, true); any = true; Rep("cleared " + name); } catch (Exception e) { Rep($"could not clear {name}: {e.Message}"); }
        }
        return any;
    }

    // Discord's own installer over the existing install repairs a broken one and keeps all your data
    private static bool TryReinstall()
    {
        if (Console.IsInputRedirected) return false;
        Console.WriteLine();
        Console.WriteLine("Discord's files are broken. I can download Discord's official installer (discord.com) and run it:");
        Console.WriteLine("it repairs the install and keeps your account, servers and messages. Do it? (y/n)");
        if (!(Console.ReadLine() ?? "").Trim().StartsWith("y", StringComparison.OrdinalIgnoreCase)) { Rep("Reinstall: declined."); return false; }
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var file = Path.Combine(Path.GetTempPath(), "DiscordSetup.exe");
            using (var wc = new WebClient()) wc.DownloadFile("https://discord.com/api/download?platform=win", file);
            Rep("Reinstall: running Discord's installer");
            Run(file, "", null);
            Thread.Sleep(5000);
            DiscordKit.Kill(new DiscordInstall { Name = "Discord" });
            Fixed.Add("Reinstalled Discord with its official installer");
            return DiscordKit.Find().Any(i => i.AppDir != null);
        }
        catch (Exception e) { Rep("Reinstall failed: " + e.Message); return false; }
    }

    /* ---------- helpers ---------- */

    private static bool ValidJson(string file, out Dictionary<string, object> map)
    {
        map = null;
        try { map = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 200 }.DeserializeObject(File.ReadAllText(file)) as Dictionary<string, object>; return map != null; }
        catch { return false; }
    }

    private static string Capture(string file, string args)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(file, args) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true });
            var o = p.StandardOutput.ReadToEnd().Trim();
            p.StandardError.ReadToEnd();
            p.WaitForExit();
            return p.ExitCode == 0 ? o.Split('\n')[0].Trim() : null;
        }
        catch { return null; }
    }

    private static int Run(string file, string args, string cwd)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(file, args) { UseShellExecute = false, WorkingDirectory = cwd ?? Environment.CurrentDirectory });
            p.WaitForExit();
            return p.ExitCode;
        }
        catch (Exception e) { Rep($"could not run {file}: {e.Message}"); return -1; }
    }

    // user name out of the report: paths show %USERPROFILE%
    private static string Scrub(string text)
    {
        text = text.Replace(Home, "%USERPROFILE%");
        return Regex.Replace(text, Regex.Escape(Environment.UserName), "<user>", RegexOptions.IgnoreCase);
    }

    private static string Quote(string s) => "\"" + s + "\"";
    private static void Rep(string line) => Report.AppendLine(line);
    private static void Section(string title) { Report.AppendLine().AppendLine("== " + title + " =="); }
    private static void Say(string text, ConsoleColor color) { Console.ForegroundColor = color; Console.WriteLine(text); Console.ResetColor(); }
}

