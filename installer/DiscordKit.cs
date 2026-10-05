// What Terono Setup and Terono Diagnostics both need to know about a Discord install: where it is, whether it is
// patched for Terono (Vencord) and whether the patch can leave Discord unable to open, and a real "does it open" test.
// Nothing here touches Discord's own data (messages, login, settings).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace TeronoTools;

internal sealed class DiscordInstall
{
    public string Name;        // Discord, DiscordPTB, DiscordCanary
    public string Root;        // %LOCALAPPDATA%\Discord
    public string UpdateExe;
    public string AppDir;      // newest app-x.y.z folder (null when there is none)
    public string Resources => AppDir == null ? null : Path.Combine(AppDir, "resources");
    public string AppAsar => Path.Combine(Resources, "app.asar");
    public string OriginalAsar => Path.Combine(Resources, "_app.asar");
}

internal enum PatchState { NotInstalled, Stock, Patched, Guarded, Broken }

internal static class DiscordKit
{
    // an index.js that starts Discord without Terono when Terono's files are gone, instead of failing to open
    private const string GuardMarker = "/*terono-guard*/";

    public static List<DiscordInstall> Find()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var list = new List<DiscordInstall>();
        foreach (var name in new[] { "Discord", "DiscordPTB", "DiscordCanary" })
        {
            var root = Path.Combine(local, name);
            if (!Directory.Exists(root)) continue;
            var app = Directory.GetDirectories(root, "app-*")
                .Select(d => new { d, v = ParseVersion(Path.GetFileName(d)) })
                .Where(x => File.Exists(Path.Combine(x.d, name + ".exe")))
                .OrderByDescending(x => x.v).Select(x => x.d).FirstOrDefault();
            list.Add(new DiscordInstall { Name = name, Root = root, UpdateExe = Path.Combine(root, "Update.exe"), AppDir = app });
        }
        return list;
    }

    private static Version ParseVersion(string folder)
    {
        return Version.TryParse(folder.Substring(4), out var v) ? v : new Version(0, 0);
    }

    public static PatchState State(DiscordInstall d, out string patcherPath)
    {
        patcherPath = null;
        if (d.AppDir == null) return PatchState.NotInstalled;
        if (!File.Exists(d.AppAsar)) return PatchState.Broken;
        if (new FileInfo(d.AppAsar).Length > 16 * 1024) return PatchState.Stock;
        if (!File.Exists(d.OriginalAsar)) return PatchState.Broken;

        var text = Encoding.UTF8.GetString(File.ReadAllBytes(d.AppAsar));
        var guarded = text.Contains(GuardMarker);
        var m = guarded ? Regex.Match(text, "const P=\"((?:[^\"\\\\]|\\\\.)*)\"") : Regex.Match(text, "require\\(\"((?:[^\"\\\\]|\\\\.)*)\"\\)");
        if (m.Success) patcherPath = Regex.Unescape(m.Groups[1].Value);
        return guarded ? PatchState.Guarded : PatchState.Patched;
    }

    public static bool PatcherUsable(string patcherPath)
    {
        try { return patcherPath != null && new FileInfo(patcherPath).Length > 1000; } catch { return false; }
    }

    // Vencord's own patch is a tiny app.asar that requires patcher.js: when that file is missing (Terono folder moved
    // or deleted, an interrupted build, an antivirus) Discord can't open. This one falls back to the original app.
    public static void WriteGuard(DiscordInstall d, string patcherPath)
    {
        var p = "\"" + patcherPath.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        var index = GuardMarker + "\n"
            + "const fs=require(\"fs\"),path=require(\"path\");\n"
            + "const P=" + p + ";\n"
            + "let ok=false;try{ok=fs.statSync(P).size>1000}catch(e){}\n"
            + "if(ok){require(P)}else{\n"
            + " console.error(\"[Terono] \"+P+\" is missing, starting Discord without Terono\");\n"
            + " const asar=path.join(__dirname,\"..\",\"_app.asar\");\n"
            + " const pkg=require(path.join(asar,\"package.json\"));\n"
            + " require.main.filename=path.join(asar,pkg.main);\n"
            + " require(\"electron\").app.setAppPath(asar);\n"
            + " require(require.main.filename);\n"
            + "}\n";
        File.WriteAllBytes(d.AppAsar, BuildAsar(index, "{\n\t\"name\": \"discord\",\n\t\"main\": \"index.js\"\n}"));
    }

    // the asar format: [4][header size + 8][header size + 4][json length][json, padded to 4][files]
    private static byte[] BuildAsar(string indexJs, string packageJson)
    {
        var a = new UTF8Encoding(false).GetBytes(indexJs);
        var b = new UTF8Encoding(false).GetBytes(packageJson);
        var json = new UTF8Encoding(false).GetBytes("{\"files\":{\"index.js\":{\"size\":" + a.Length + ",\"offset\":\"0\"},\"package.json\":{\"size\":" + b.Length + ",\"offset\":\"" + a.Length + "\"}}}");
        var padded = (json.Length + 3) & ~3;
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write(4); w.Write(padded + 8); w.Write(padded + 4); w.Write(json.Length);
        w.Write(json); w.Write(new byte[padded - json.Length]);
        w.Write(a); w.Write(b);
        return ms.ToArray();
    }

    // back to plain Discord: the original app goes back where Discord expects it
    public static bool Unpatch(DiscordInstall d)
    {
        if (d.AppDir == null || !File.Exists(d.OriginalAsar)) return false;
        File.Delete(d.AppAsar);
        File.Move(d.OriginalAsar, d.AppAsar);
        return true;
    }

    public static void Kill(DiscordInstall d)
    {
        foreach (var p in Process.GetProcessesByName(d.Name))
        {
            try { p.Kill(); p.WaitForExit(5000); } catch { /* already closed */ }
            finally { p.Dispose(); }
        }
        Thread.Sleep(1500);
    }

    // Starts Discord the way its shortcut does and waits until it really shows its window (or gives up).
    public static bool Launch(DiscordInstall d, int seconds, out string note)
    {
        note = "";
        if (!File.Exists(d.UpdateExe)) { note = "Update.exe is missing"; return false; }
        try
        {
            Process.Start(new ProcessStartInfo(d.UpdateExe, "--processStart " + d.Name + ".exe") { UseShellExecute = false, WorkingDirectory = d.Root });
        }
        catch (Exception e) { note = "could not start: " + e.Message; return false; }

        var start = DateTime.UtcNow;
        var seen = false;
        var windowPolls = 0;
        while ((DateTime.UtcNow - start).TotalSeconds < seconds)
        {
            Thread.Sleep(1500);
            var procs = Process.GetProcessesByName(d.Name);
            try
            {
                if (procs.Length == 0)
                {
                    // it started and then went away: a crash
                    if (seen && (DateTime.UtcNow - start).TotalSeconds > 8) { note = "Discord started and then closed by itself"; return false; }
                    continue;
                }
                seen = true;
                var window = procs.Any(p =>
                {
                    try { var t = p.MainWindowTitle; return p.MainWindowHandle != IntPtr.Zero && t.Contains("Discord") && !t.Contains("Updater"); }
                    catch { return false; }
                });
                windowPolls = window ? windowPolls + 1 : 0;
                if (windowPolls >= 3) { note = "Discord opened"; return true; }
                // started minimized to the tray: many processes and still alive
                if ((DateTime.UtcNow - start).TotalSeconds > 30 && procs.Length >= 3) { note = "Discord is running (no window: it may start minimized)"; return true; }
            }
            finally { foreach (var p in procs) p.Dispose(); }
        }
        note = seen ? "Discord started but never showed a window" : "Discord never started";
        return false;
    }
}
