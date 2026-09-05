<#
.SYNOPSIS
Bring both halves of the draft room up, and say what was already running.

.DESCRIPTION
One command to run before a draft. The data service goes up through
scripts/service.mjs, which owns the staleness check and the detached start, and
the interface goes up in a window of its own so Vite's output stays visible and
closing that window is how you stop it.

Both halves are reported either way, because the trap before a draft is not a
port that refuses. It is a service left running from an earlier session, which
answers perfectly well while serving code that has since changed.

Stopping is deliberately not here. Close the interface window, and use
.\serve.ps1 stop for the service, which refuses to touch a port held by
something that is not this project.

Run it from anywhere; it resolves the repository from its own location.

.PARAMETER Action
'start' brings up whatever is not up, and is the default. 'status' reports and
changes nothing.

.EXAMPLE
.\dev.ps1
Start whatever is not running, then report both halves.

.EXAMPLE
.\dev.ps1 status
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'status')]
    [string]$Action = 'start'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

$service = Join-Path $PSScriptRoot 'scripts/service.mjs'
if (-not (Test-Path -LiteralPath $service)) {
    throw "Cannot find $service. Run this from inside the repository."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'node is not on PATH. This project needs Node ^20.19.0 or >=22.12.0.'
}

$clientPort = if ($env:CLIENT_PORT) { [int]$env:CLIENT_PORT } else { 5177 }

# Asked of the port rather than of the process list, so this says the same thing
# whoever is holding it and needs no elevation to find out.
#
# By name rather than by address, and that is not a detail. Vite binds whatever
# `localhost` resolves to, which on this machine is `::1` alone, so a probe of
# `127.0.0.1` reports a running interface as down and this would cheerfully
# start a second one. Connecting by name tries every address the name has.
function Test-Port {
    param([int]$Port)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        return $client.ConnectAsync('localhost', $Port).Wait(1500)
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

$clientUp = Test-Port -Port $clientPort

if ($Action -eq 'status') {
    & node $service status
    Write-Information ''
    if ($clientUp) {
        Write-Information "The interface is answering on localhost:$clientPort."
    } else {
        Write-Information "Nothing is on localhost:$clientPort."
    }
    exit 0
}

# The service first. It knows how to be idempotent, and reports staleness on
# the way, which is the answer worth having before trusting anything it serves.
& node $service start
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($clientUp) {
    Write-Information "The interface was already on localhost:$clientPort."
} else {
    Write-Information "Starting the interface on localhost:$clientPort, in a window of its own."
    Start-Process -FilePath 'pwsh' -WorkingDirectory $PSScriptRoot -ArgumentList @(
        '-NoLogo', '-NoExit', '-Command', 'npm run dev:client'
    )

    # Vite is quick but not instant, and reporting a port that is not open yet
    # would be worse than waiting a moment to tell the truth about it.
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Port -Port $clientPort) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
    if (Test-Port -Port $clientPort) {
        Write-Information "The interface is answering on localhost:$clientPort."
    } else {
        Write-Warning "Nothing answered on $clientPort within 30s. Read the window it opened."
        exit 1
    }
}

Write-Information ''
Write-Information "Open http://localhost:$clientPort"
