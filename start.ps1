# One-click launcher: ensures Node.js, starts server.mjs, opens the app. Run via Start.cmd.
#   -Portable   use a private Node in .runtime\ instead of the system one (downloaded if missing)
#   -NoBrowser  start the server without opening a browser
param([switch]$Portable, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$MinNode = 18
$root = $PSScriptRoot
$runtime = Join-Path $root '.runtime\node\node.exe'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-NodeMajor($exe) { try { [int]((& $exe --version) -replace '^v(\d+).*', '$1') } catch { 0 } }
function Find-Node {
  $candidates = if ($Portable) { @($runtime) } else { @((Get-Command node -ErrorAction SilentlyContinue).Source, "$env:ProgramFiles\nodejs\node.exe", $runtime) }
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
  $dest = Join-Path $root '.runtime'
  if (Test-Path "$dest\node") { Remove-Item "$dest\node" -Recurse -Force }
  Expand-Archive $zip $dest -Force
  Rename-Item (Join-Path $dest $name) 'node'
  Remove-Item $zip
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
Write-Host "Using Node $(& $node --version) at $node"

# Already running? Just open it.
for ($port = 8000; $port -lt 8020; $port++) {
  try { $h = Invoke-RestMethod "http://localhost:$port/api/health" -TimeoutSec 1; if ($h.mode -eq 'server') { $running = $port; break } } catch {}
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { break }
}
$url = "http://localhost:$(if ($running) { $running } else { $port })/"
if ($running) {
  Write-Host "Already running at $url"
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}

$env:PORT = $port
$server = Start-Process $node -ArgumentList 'server.mjs' -WorkingDirectory $root -NoNewWindow -PassThru
for ($i = 0; $i -lt 50; $i++) {
  if ($server.HasExited) { throw "Server exited with code $($server.ExitCode)." }
  try { if ((Invoke-RestMethod "${url}api/health" -TimeoutSec 1).ok) { $ready = $true; break } } catch { Start-Sleep -Milliseconds 200 }
}
if (-not $ready) { Stop-Process $server.Id -Force; throw 'Server did not become ready in 10 seconds.' }

Write-Host "`nVideo Intelligence is running at $url"
Write-Host 'Close this window (or press Ctrl+C) to stop it.'
if (-not $NoBrowser) { Start-Process $url }
Wait-Process $server.Id
