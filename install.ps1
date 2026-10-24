# Terono installer for Windows
#   irm https://raw.githubusercontent.com/darkzmaj/Terono/main/install.ps1 | iex
# Builds Vencord with the Terono plugin, installs it into Discord and adds the Terono theme.
# Run it again any time to update.

$Dir = if ($env:TERONO_DIR) { $env:TERONO_DIR } else { Join-Path $HOME "Terono" }
$Vencord = Join-Path $Dir "Vencord"
$Plugin = Join-Path $Vencord "src\userplugins\terono"

function Step($text) { Write-Host "`n> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }
function Check($what) { if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE)." } }

# Git and Node.js are needed to build Vencord; install them with winget when missing
$needed = @(@{ Cmd = "git"; Id = "Git.Git"; Url = "https://git-scm.com/download/win" }, @{ Cmd = "node"; Id = "OpenJS.NodeJS.LTS"; Url = "https://nodejs.org" })
foreach ($t in $needed) {
    if (Get-Command $t.Cmd -ErrorAction SilentlyContinue) { continue }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail "$($t.Cmd) is required. Install it from $($t.Url), then run this again." }
    Step "Installing $($t.Cmd) (needed once)"
    winget install --id $t.Id -e --silent --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Get-Command $t.Cmd -ErrorAction SilentlyContinue)) { Fail "$($t.Cmd) was installed but is not available yet. Close this window and run the installer again." }
}

New-Item -ItemType Directory -Force $Dir | Out-Null

# Existing download: fetch the newest version and reset to it. Missing or damaged: download it fresh.
# The Terono folder sits inside the Vencord download; if its own .git is damaged git silently uses Vencord's,
# so only a folder that is its own repository root with the expected source counts.
function Sync($url, $path) {
    if (Test-Path (Join-Path $path ".git")) {
        $top = git -C $path rev-parse --show-toplevel 2>$null
        $origin = git -C $path remote get-url origin 2>$null
        $same = $top -and ((Resolve-Path $top).Path.TrimEnd("\") -eq (Resolve-Path $path).Path.TrimEnd("\")) -and ($origin -replace "\.git$", "") -eq $url
        if ($same) {
            git -C $path fetch --depth 1 origin main
            if ($LASTEXITCODE -eq 0) { git -C $path reset --hard FETCH_HEAD; if ($LASTEXITCODE -eq 0) { return } }
        }
        Write-Host "The download folder is damaged, downloading it again." -ForegroundColor Yellow
    }
    if (Test-Path $path) { Remove-Item -Recurse -Force $path }
    git clone --depth 1 $url $path
}

Step "Getting Vencord"
Sync "https://github.com/Vendicated/Vencord" $Vencord
Check "Downloading Vencord"

Step "Getting Terono"
Sync "https://github.com/darkzmaj/Terono" $Plugin
Check "Downloading Terono"

Push-Location $Vencord
try {
    $pnpm = (Get-Content package.json -Raw | ConvertFrom-Json).packageManager

    Step "Installing build tools (first run takes a minute)"
    npx -y $pnpm install --frozen-lockfile
    Check "Installing dependencies"

    Step "Building"
    npx -y $pnpm build
    Check "Build"

    if ($env:TERONO_NO_INJECT) { Step "Build finished (TERONO_NO_INJECT set, Discord left untouched)"; return }

    Step "Closing Discord"
    Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2

    Step "Installing into Discord"
    node scripts/runInstaller.mjs -- --install --branch auto
    Check "Installing into Discord"

    Step "Enabling Terono"
    node (Join-Path $Plugin "scripts\enable.mjs")
    Check "Enabling Terono"

    $update = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
    if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", "Discord.exe" }

    Write-Host "`nTerono is installed. Open Settings > Vencord > Plugins > Terono to customize it." -ForegroundColor Green
} finally {
    Pop-Location
}
