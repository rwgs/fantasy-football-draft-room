<#
.SYNOPSIS
Start, stop, restart or inspect the data service.

.DESCRIPTION
A thin front for scripts/service.mjs, which holds all the logic and runs the
same on every platform. This exists for one reason: npm needs `npm run serve --
restart` to pass an argument through, and the bare `--` is easy to forget and
silently drops the action when it is. Here the action is just an argument, with
tab completion and a usable -Port.

Run it from anywhere; it resolves the repository from its own location.

.PARAMETER Action
What to do. Omit it to be told what is running and offered the choices that
apply.

.PARAMETER Port
The port to act on. Defaults to 5178, or $env:PORT if that is set.

.EXAMPLE
.\serve.ps1
Report what is running, then offer to restart, stop, or leave it.

.EXAMPLE
.\serve.ps1 restart

.EXAMPLE
.\serve.ps1 status -Port 5179
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action,

    [ValidateRange(1, 65535)]
    [int]$Port
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'scripts/service.mjs'
if (-not (Test-Path -LiteralPath $script)) {
    throw "Cannot find $script. Run this from inside the repository."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'node is not on PATH. This project needs Node ^20.19.0 or >=22.12.0.'
}

if ($PSBoundParameters.ContainsKey('Port')) { $env:PORT = $Port }

# Pass the action only when one was given, so an empty string is never taken
# for an unknown action.
if ($Action) { & node $script $Action } else { & node $script }

exit $LASTEXITCODE
