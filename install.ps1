# BlitzPi installer for Windows — the PowerShell twin of install.sh. One line, nothing else on the system:
#
#   irm https://raw.githubusercontent.com/rvillaver/BlitzPi/master/install.ps1 | iex
#
# Layout:  %LOCALAPPDATA%\BlitzPi\bun\bin\bun.exe      private Bun runtime
#          %LOCALAPPDATA%\BlitzPi\versions\<version>\   one complete BlitzPi per version
#          %LOCALAPPDATA%\BlitzPi\current               junction -> versions\<version>
#          %LOCALAPPDATA%\BlitzPi\bin\blitzpi.cmd        the command (added to the user PATH)
#          %LOCALAPPDATA%\BlitzPi\install.ps1            app-level installer (newest); blitzpi update|versions|rollback|use|uninstall run it
# Options: -Update  -Uninstall [-Purge]  -Yes  -Version vX.Y.Z [-Reinstall]  -PrintPaths  -List  -Rollback  -Use <version>  -Refresh
#          -Feeds | -NoFeeds   (security feeds are an OPT-IN download, separate from the platform)
# Env:     BLITZPI_HOME (app dir override), BLITZPI_SOURCE (local dir or .tar.gz instead of GitHub), BLITZPI_KEEP (versions kept, default 2)
[CmdletBinding()]
param(
  [switch]$Update, [switch]$Uninstall, [switch]$Purge, [switch]$Yes, [string]$Version = "", [switch]$Reinstall,
  [switch]$PrintPaths, [switch]$List, [switch]$Rollback, [string]$Use = "", [switch]$Refresh, [switch]$Feeds, [switch]$NoFeeds
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$REPO = "rvillaver/BlitzPi"
$BUN_VERSION = "1.4.0"
$BUN_TARGET = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "windows-aarch64" } else { "windows-x64" }
$KEEP = 2; if ($env:BLITZPI_KEEP -match '^\d+$') { $KEEP = [Math]::Max(1, [int]$env:BLITZPI_KEEP) }
$APP = if ($env:BLITZPI_HOME) { $env:BLITZPI_HOME } else { Join-Path $env:LOCALAPPDATA "BlitzPi" }
$BUN = Join-Path $APP "bun\bin\bun.exe"
$BIN_DIR = Join-Path $APP "bin"
$SHIM = Join-Path $BIN_DIR "blitzpi.cmd"
$HOME_DIR = $env:USERPROFILE
$FEEDS_OPT = Join-Path $HOME_DIR ".blitz\feeds\opt-in"; $FEEDS_OUT = Join-Path $HOME_DIR ".blitz\feeds\opt-out"

function Say([string]$m) { Write-Host $m }
function Die([string]$m) { Write-Host "BlitzPi: $m" -ForegroundColor Red; exit 1 }
function Confirm-Step([string]$q) {
  if ($Yes -or $Update) { return $true }
  if (-not [Environment]::UserInteractive) { return $false }
  $a = Read-Host "$q [Y/n]"; return ($a -eq "" -or $a -match '^(y|yes)$')
}
function Current-Version {
  $c = Join-Path $APP "current"
  if (Test-Path $c) { $item = Get-Item $c -Force; if ($item.Target) { return Split-Path -Leaf ($item.Target | Select-Object -First 1) } }
  return ""
}
function Installed([string]$v) { (Test-Path (Join-Path $APP "versions\$v\node_modules\@earendil-works\pi-coding-agent")) -and (Test-Path (Join-Path $APP "versions\$v\bin\blitzpi.ts")) }
function List-Versions { $d = Join-Path $APP "versions"; if (-not (Test-Path $d)) { return @() }; Get-ChildItem $d -Directory | Where-Object { $_.Name -notlike "*.partial" } | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.Name } }
function Write-Shim {
  New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null
  $lines = @(
    '@echo off',
    'setlocal',
    'set "APP=%LOCALAPPDATA%\BlitzPi"',
    'if defined BLITZPI_HOME set "APP=%BLITZPI_HOME%"',
    'rem Self-service commands go to the newest installer, not to the version that happens to be current.',
    'if /I "%~1"=="update"    goto :self',
    'if /I "%~1"=="uninstall" goto :self',
    'if /I "%~1"=="versions"  goto :self',
    'if /I "%~1"=="rollback"  goto :self',
    'if /I "%~1"=="use"       goto :self',
    'set "PATH=%APP%\bun\bin;%PATH%"',
    '"%APP%\bun\bin\bun.exe" "%APP%\current\bin\blitzpi.ts" %*',
    'exit /b %errorlevel%',
    ':self',
    'set "FLAG=-Update"',
    'if /I "%~1"=="uninstall" set "FLAG=-Uninstall"',
    'if /I "%~1"=="versions"  set "FLAG=-List"',
    'if /I "%~1"=="rollback"  set "FLAG=-Rollback"',
    'if /I "%~1"=="use"       set "FLAG=-Use"',
    'shift',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%APP%\install.ps1" %FLAG% %1 %2 %3',
    'exit /b %errorlevel%'
  )
  Set-Content -Path $SHIM -Value ($lines -join "`r`n") -Encoding ASCII
}
function Add-UserPath {
  $cur = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($cur -split ';') -contains $BIN_DIR) { return $false }
  [Environment]::SetEnvironmentVariable("Path", (($cur.TrimEnd(';')) + ";" + $BIN_DIR), "User")
  $env:Path = "$env:Path;$BIN_DIR"
  return $true
}
function Remove-UserPath {
  $cur = [Environment]::GetEnvironmentVariable("Path", "User")
  $new = ($cur -split ';' | Where-Object { $_ -and $_ -ne $BIN_DIR }) -join ';'
  [Environment]::SetEnvironmentVariable("Path", $new, "User")
}
function Set-Current([string]$v) {
  $c = Join-Path $APP "current"
  if (Test-Path $c) { cmd /c rmdir "$c" | Out-Null }   # removes the junction, never its target
  cmd /c mklink /J "$c" (Join-Path $APP "versions\$v") | Out-Null
}
function Switch-To([string]$v) {
  if (-not (Installed $v)) { Die "BlitzPi $v is not installed (blitzpi versions)" }
  $prev = Current-Version
  if ($prev -eq $v) { Say "BlitzPi $v is already current."; return }
  Set-Current $v
  if ($prev) { Set-Content -Path (Join-Path $APP "previous") -Value $prev -Encoding ASCII }
  Write-Shim
  $out = & $SHIM --version 2>&1
  Say "Now current: $out$(if ($prev) { "  (was $prev - 'blitzpi rollback' returns to it)" })"
}
function Refresh-Self {
  if ($PSCommandPath -and (Test-Path $PSCommandPath)) { Copy-Item $PSCommandPath (Join-Path $APP "install.ps1") -Force }
  Write-Shim
}
function Ask-Feeds([string]$q) {
  $script:ANSWERED = $false
  if ($Feeds) { $script:ANSWERED = $true; return $true }
  if ($NoFeeds) { $script:ANSWERED = $true; return $false }
  if (-not [Environment]::UserInteractive) { return $false }
  $a = Read-Host "$q [Y/n]"; $script:ANSWERED = $true
  return ($a -eq "" -or $a -match '^(y|yes)$')
}
function Feeds-Step {
  if (Test-Path $FEEDS_OPT) {
    if (Ask-Feeds "Security feeds are installed (blitzpi feeds list). Update them too?") { & $SHIM feeds update; if ($LASTEXITCODE -ne 0) { Say "WARNING: feed update failed (previous feeds kept). Retry: blitzpi feeds update" } }
    else { Say "Security feeds left as they are (blitzpi feeds update when you want them)." }
  } elseif ((Test-Path $FEEDS_OUT) -and -not $Feeds) {
    Say "Security feeds: declined earlier (blitzpi feeds opt-in to change)."
  } else {
    Say ""; Say "Security feeds (optional): detection rules pulled from public sources - credentials in commands (gitleaks),"
    Say "command shapes (Sigma) and malicious URLs (URLhaus). First download ~ 4.5 MB, ~ 1.5 MB kept in ~\.blitz\feeds;"
    Say "updated only when you say so (blitzpi feeds update)."
    if (Ask-Feeds "Install security feeds now?") { & $SHIM feeds opt-in; if ($LASTEXITCODE -ne 0) { Say "WARNING: feed install failed. Retry: blitzpi feeds opt-in" } }
    elseif ($script:ANSWERED) { New-Item -ItemType Directory -Force -Path (Split-Path $FEEDS_OUT) | Out-Null; Set-Content -Path $FEEDS_OUT -Value (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"); Say "Declined - recorded; blitzpi feeds opt-in if you change your mind." }
    else { Say "Skipped (no answer). BlitzPi will ask when it starts; or: blitzpi feeds opt-in" }
  }
}

# ---- modes that need no download -------------------------------------------------------------
if ($PrintPaths) { Say "platform=windows"; Say "home=$APP"; Say "versions=$APP\versions"; Say "current=$APP\current"; Say "bun=$BUN"; Say "binDir=$BIN_DIR"; Say "shim=$SHIM"; Say "bunTarget=$BUN_TARGET"; exit 0 }
if ($Refresh) { New-Item -ItemType Directory -Force -Path $APP | Out-Null; Refresh-Self; Say "BlitzPi command refreshed: $SHIM (installer: $APP\install.ps1)"; exit 0 }
if ($List) {
  $cur = Current-Version; $prev = if (Test-Path (Join-Path $APP "previous")) { (Get-Content (Join-Path $APP "previous") -Raw).Trim() } else { "" }
  $vs = @(List-Versions); if (-not $vs.Count) { Die "nothing installed under $APP\versions" }
  Say "Installed BlitzPi versions ($APP\versions, newest first; keeping $KEEP):"
  foreach ($n in $vs) { $mark = if ($n -eq $cur) { "* " } else { "  " }; $note = if ($n -eq $prev) { "   (previous - blitzpi rollback)" } elseif (-not (Installed $n)) { "   (incomplete)" } else { "" }; Say "  $mark$n$note" }
  Say "  * = current.   Switch: blitzpi use <version>   Roll back: blitzpi rollback   Newer: blitzpi update"; exit 0
}
if ($Use) { Switch-To ($Use -replace '^v', ''); exit 0 }
if ($Rollback) {
  $cur = Current-Version; $target = if (Test-Path (Join-Path $APP "previous")) { (Get-Content (Join-Path $APP "previous") -Raw).Trim() } else { "" }
  if (-not $target -or $target -eq $cur -or -not (Installed $target)) { $target = @(List-Versions | Where-Object { $_ -ne $cur }) | Select-Object -First 1 }
  if (-not $target) { Die "no other version installed to roll back to (blitzpi versions)" }
  Switch-To $target; exit 0
}
if ($Uninstall) {
  Say "This removes BlitzPi:"; Say "  app directory : $APP"; Say "  command       : $SHIM"
  if ($Purge) { Say "  audit + global config : $HOME_DIR\.blitz  (-Purge)" }
  Say "Kept: your Pi logins in $HOME_DIR\.pi$(if (-not $Purge) { ', your audit trail in ' + $HOME_DIR + '\.blitz (add -Purge to remove)' })."
  if (-not (Confirm-Step "Uninstall BlitzPi?")) { Say "Cancelled."; exit 0 }
  if (Test-Path (Join-Path $APP "current")) { cmd /c rmdir (Join-Path $APP "current") | Out-Null }
  Remove-Item -Recurse -Force $APP -ErrorAction SilentlyContinue
  Remove-UserPath
  if ($Purge) { Remove-Item -Recurse -Force (Join-Path $HOME_DIR ".blitz") -ErrorAction SilentlyContinue }
  Say "BlitzPi has been uninstalled."; exit 0
}

# ---- resolve the version to install -----------------------------------------------------------
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Die "tar.exe is required (Windows 10 1803+ ships it)" }
$SOURCE = $env:BLITZPI_SOURCE
if ($SOURCE) {
  $VER = if ($Version) { $Version -replace '^v', '' } else { "local" }
  if (Test-Path $SOURCE -PathType Container) { $pj = Get-Content (Join-Path $SOURCE "package.json") -Raw | ConvertFrom-Json; if ($pj.version) { $VER = $pj.version } }
} elseif ($Version) {
  $VER = $Version -replace '^v', ''
} else {
  try { $rel = Invoke-RestMethod "https://api.github.com/repos/$REPO/releases/latest" -Headers @{ "User-Agent" = "blitzpi-installer" } } catch { Die "could not reach GitHub to find the latest release ($($_.Exception.Message))" }
  $VER = ($rel.tag_name -replace '^v', ''); if (-not $VER) { Die "no release found for $REPO" }
}
$DEST = Join-Path $APP "versions\$VER"
$CURRENT_VERSION = Current-Version
if ($Version -and -not $Reinstall -and (Installed $VER)) { Say "BlitzPi $VER is already installed - switching to it (add -Reinstall to download it again)."; Switch-To $VER; exit 0 }
if ($Update -and $CURRENT_VERSION -eq $VER -and -not $SOURCE) { Say "BlitzPi $VER is already the latest version."; Feeds-Step; exit 0 }

# ---- plan + consent ---------------------------------------------------------------------------
Say ""
if ($Update) { Say "Updating BlitzPi $(if ($CURRENT_VERSION) { $CURRENT_VERSION } else { '?' }) -> $VER" } else { Say "BlitzPi $VER - Windows $BUN_TARGET" }
Say "  app directory : $APP"; Say "  runtime       : $APP\bun  (private Bun $BUN_VERSION, $BUN_TARGET)"; Say "  version       : $DEST"; Say "  command       : $SHIM"
if (-not (([Environment]::GetEnvironmentVariable("Path", "User") -split ';') -contains $BIN_DIR)) { Say "  user PATH     : + $BIN_DIR  (so 'blitzpi' is found in new terminals)" }
Say "Nothing is installed anywhere else on your system."; Say ""
if (-not (Confirm-Step "Install here?")) { Say "Cancelled. Set BLITZPI_HOME to choose another directory."; exit 0 }

New-Item -ItemType Directory -Force -Path (Join-Path $APP "versions"), (Join-Path $APP "tmp"), $BIN_DIR | Out-Null
$TMP = Join-Path $APP ("tmp\" + [IO.Path]::GetRandomFileName()); New-Item -ItemType Directory -Force -Path $TMP | Out-Null
try {
  # ---- private Bun runtime --------------------------------------------------------------------
  $bunVersionFile = Join-Path $APP "bun\VERSION"
  if (-not (Test-Path $BUN) -or ((Test-Path $bunVersionFile) -and ((Get-Content $bunVersionFile -Raw).Trim() -ne $BUN_VERSION)) -or -not (Test-Path $bunVersionFile)) {
    Say "Downloading Bun $BUN_VERSION ($BUN_TARGET)..."
    Invoke-WebRequest -Uri "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-$BUN_TARGET.zip" -OutFile (Join-Path $TMP "bun.zip") -UseBasicParsing
    Expand-Archive -Path (Join-Path $TMP "bun.zip") -DestinationPath (Join-Path $TMP "bun") -Force
    $newBun = Join-Path $APP "bun.new"; Remove-Item -Recurse -Force $newBun -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Join-Path $newBun "bin") | Out-Null
    Move-Item (Join-Path $TMP "bun\bun-$BUN_TARGET\bun.exe") (Join-Path $newBun "bin\bun.exe")
    Set-Content -Path (Join-Path $newBun "VERSION") -Value $BUN_VERSION -NoNewline -Encoding ASCII
    Remove-Item -Recurse -Force (Join-Path $APP "bun") -ErrorAction SilentlyContinue; Move-Item $newBun (Join-Path $APP "bun")
  }
  & $BUN --version | Out-Null; if ($LASTEXITCODE -ne 0) { Die "the downloaded Bun runtime does not run on this machine ($BUN_TARGET)" }

  # ---- BlitzPi release -> versions\<version> ---------------------------------------------------
  $STAGE = "$DEST.partial"; Remove-Item -Recurse -Force $STAGE -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force -Path $STAGE | Out-Null
  if ($SOURCE -and (Test-Path $SOURCE -PathType Container)) {
    Say "Copying BlitzPi from $SOURCE..."
    tar.exe -C $SOURCE --exclude=./node_modules --exclude=./.git --exclude=./runs -cf - . | tar.exe -C $STAGE -xf -
  } else {
    $tarball = if ($SOURCE) { $SOURCE } else { Say "Downloading BlitzPi $VER..."; $t = Join-Path $TMP "blitzpi.tar.gz"; Invoke-WebRequest -Uri "https://github.com/$REPO/archive/refs/tags/v$VER.tar.gz" -OutFile $t -UseBasicParsing; $t }
    tar.exe -C $STAGE --strip-components=1 -xzf $tarball
    if ($LASTEXITCODE -ne 0) { Die "could not extract $tarball" }
  }
  Say "Installing Pi and bundled packages (this takes a minute)..."
  $env:BUN_INSTALL_CACHE_DIR = Join-Path $APP "cache"
  Push-Location $STAGE
  try { & $BUN install --frozen-lockfile --production *> (Join-Path $STAGE ".install.log"); if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $STAGE ".install.log") -Tail 20 | Write-Host; Die "dependency install failed (log: $STAGE\.install.log)" } }
  finally { Pop-Location }
  $piName = & $BUN -e 'process.stdout.write(require("' + ($STAGE -replace '\\', '/') + '/node_modules/@earendil-works/pi-coding-agent/package.json").piConfig?.name||"")'
  if ($piName -ne "blitzpi") { Die "rebrand patch was not applied (piConfig.name='$piName')" }
  if (Test-Path $DEST) { Remove-Item -Recurse -Force $DEST }
  Move-Item $STAGE $DEST
  if (Test-Path (Join-Path $DEST "install.ps1")) { Copy-Item (Join-Path $DEST "install.ps1") (Join-Path $APP "install.ps1") -Force }

  # ---- switch current, write the command, keep the newest $KEEP versions ------------------------
  Set-Current $VER
  if ($CURRENT_VERSION -and $CURRENT_VERSION -ne $VER) { Set-Content -Path (Join-Path $APP "previous") -Value $CURRENT_VERSION -Encoding ASCII }
  Write-Shim
  $i = 0
  foreach ($n in @(List-Versions)) { $i++; if ($n -eq $VER -or $n -eq $CURRENT_VERSION) { continue }; if ($i -gt $KEEP) { Remove-Item -Recurse -Force (Join-Path $APP "versions\$n") -ErrorAction SilentlyContinue } }
  $pathAdded = Add-UserPath

  # ---- self-check ------------------------------------------------------------------------------
  $out = & $SHIM --version 2>&1
  if ($LASTEXITCODE -ne 0) { Die "installed but 'blitzpi --version' failed: $out" }
  Say ""; Say "Installed: $out"
  if ($pathAdded) { Say "Added $BIN_DIR to your user PATH - open a new terminal for 'blitzpi' to be found." }
  Feeds-Step
  Say ""; Say "Run 'blitzpi' inside a project folder to start."
} finally {
  Remove-Item -Recurse -Force $TMP -ErrorAction SilentlyContinue
}
