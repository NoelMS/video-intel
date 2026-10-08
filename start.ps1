# Setup + launch, run via Start.cmd. Ensures Node.js, builds the windowless launcher, registers video-intel://
# (so the installed app icon can start the server), starts the server hidden, opens the app, then exits:
# no terminal stays open. The app itself offers to install ffmpeg, Ollama and the vision model.
#   -Portable   use a private Node in .runtime\ instead of the system one (downloaded if missing)
#   -NoBrowser  start the server without opening the app window
param([switch]$Portable, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$MinNode = 18
$root = $PSScriptRoot
$rt = Join-Path $root '.runtime'
$runtimeNode = Join-Path $rt 'node\node.exe'
$launcher = Join-Path $rt 'launcher.exe'
$url = 'http://localhost:8000/'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force $rt | Out-Null

function Get-NodeMajor($exe) { try { [int]((& $exe --version) -replace '^v(\d+).*', '$1') } catch { 0 } }
function Find-Node {
  $candidates = if ($Portable) { @($runtimeNode) } else { @((Get-Command node -ErrorAction SilentlyContinue).Source, "$env:ProgramFiles\nodejs\node.exe", $runtimeNode) }
  foreach ($c in $candidates) { if ($c -and (Test-Path $c) -and (Get-NodeMajor $c) -ge $MinNode) { return $c } }
}

function Install-PortableNode {
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'  # assign first: PS 5.1 pipes a JSON array as one object
  $v = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  $name = "node-$v-win-$arch"
  $zip = Join-Path $env:TEMP "$name.zip"
  Write-Host "Downloading Node.js $v ($arch)..."
  Invoke-WebRequest "https://nodejs.org/dist/$v/$name.zip" -OutFile $zip -UseBasicParsing
  # Verify against the official checksum list before extracting anything.
  $line = (Invoke-RestMethod "https://nodejs.org/dist/$v/SHASUMS256.txt") -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($name)).zip$" }
  $expected = ($line -split '\s+')[0]
  if (-not $expected -or (Get-FileHash $zip -Algorithm SHA256).Hash -ne $expected.ToUpper()) { Remove-Item $zip; throw 'Node.js download failed checksum verification.' }
  if (Test-Path "$rt\node") { Remove-Item "$rt\node" -Recurse -Force }
  Expand-Archive $zip $rt -Force
  Rename-Item (Join-Path $rt $name) 'node'
  Remove-Item $zip
}

# Windows ships the .NET Framework C# compiler; /target:winexe gives a GUI-subsystem exe, so no console appears.
function Build-Launcher {
  $src = Join-Path $root 'launcher.cs'
  if ((Test-Path $launcher) -and (Get-Item $launcher).LastWriteTime -ge (Get-Item $src).LastWriteTime) { return }
  $csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
  & $csc /nologo /target:winexe "/out:$launcher" $src
  if ($LASTEXITCODE) { throw 'Could not build the launcher.' }
}

# video-intel:// for this user (no admin). The URL is never passed to the launcher, so a link cannot inject arguments.
function Register-Protocol {
  $k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\video-intel')
  $k.SetValue('', 'URL:Video Intelligence launcher'); $k.SetValue('URL Protocol', '')
  $k.CreateSubKey('shell\open\command').SetValue('', "`"$launcher`"")
  $k.Close()
}

# Standalone app window (Edge ships with Windows; Chrome works too); else the default browser.
function Open-App {
  $b = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($b) { Start-Process $b "--app=$url" } else { Start-Process $url }
}

$node = Find-Node
if (-not $node) {
  Write-Host "Node.js $MinNode+ not found. Installing..."
  if (-not $Portable -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    $node = Find-Node
  }
  if (-not $node) { Install-PortableNode; $node = Find-Node }   # no winget, or winget failed: private copy, no admin needed
  if (-not $node) { throw "Could not install Node.js. Install it from https://nodejs.org, then run Start again." }
}
Set-Content (Join-Path $rt 'node-path.txt') $node -Encoding ASCII
Build-Launcher
Register-Protocol

$busy = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($busy) { try { $ours = (Invoke-RestMethod "${url}api/health" -TimeoutSec 3).mode -eq 'server' } catch {} }
if ($busy -and -not $ours) { throw 'Port 8000 is used by another program. Close it and run Start again.' }

$p = Start-Process $launcher -PassThru; $p.WaitForExit()   # not -Wait: in PS 5.1 that also waits for the server it spawns
if ($p.ExitCode) { throw "The server did not start. See $rt\server.log" }
if (-not $NoBrowser) { Open-App }
