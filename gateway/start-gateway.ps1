# ============================================================================
#  DSH Remote — gateway launcher (watchdog).
#
#  Normally started by double-clicking run-gateway.vbs. The gateway is restarted
#  automatically whenever it exits; Ctrl+C stops the watchdog.
#
#  The gateway only READS the DSH launcher log to pick up DSH's per-launch token —
#  it never starts, stops or patches DSH. Start DSH as usual, separately.
#
#  Paths resolve relative to this script, and node is discovered rather than
#  hardcoded. Override with:
#    $env:DSH_GATE_NODE      full path to node.exe
#    $env:DSH_GATE_TOKEN_LOG launcher stdout log (see gateway.mjs DEFAULTS)
# ============================================================================
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$gw = Join-Path $here 'gateway.mjs'
if (-not (Test-Path $gw)) { Write-Host "gateway.mjs not found next to this script" -ForegroundColor Red; exit 1 }

function Resolve-Node {
  if ($env:DSH_GATE_NODE -and (Test-Path $env:DSH_GATE_NODE)) { return $env:DSH_GATE_NODE }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe", "$env:LOCALAPPDATA\fnm_multishells")) {
    if ($p -and (Test-Path $p -PathType Leaf)) { return $p }
  }
  throw "node.exe not found. Install Node.js >= 20, or set DSH_GATE_NODE to its full path."
}

try { $node = Resolve-Node } catch { Write-Host $_ -ForegroundColor Red; exit 1 }
try { $host.UI.RawUI.WindowTitle = 'DSH Remote Gateway' } catch {}

Write-Host ''
Write-Host '  DSH Remote gateway - watchdog active' -ForegroundColor Cyan
Write-Host "  node: $node" -ForegroundColor DarkGray
Write-Host '  Restarts automatically if it exits; press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''
while ($true) {
  & $node $gw
  $code = $LASTEXITCODE
  Write-Host ''
  Write-Host ("  gateway exited (code " + $code + "); restarting in 2s...") -ForegroundColor Yellow
  Start-Sleep -Seconds 2
}
