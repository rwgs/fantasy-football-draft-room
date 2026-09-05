<#
.SYNOPSIS
Record what a Yahoo draft room receives, for reading afterwards.

.DESCRIPTION
A front for tools/yahoo/cdp-watch.mjs, which attaches to a browser over the
DevTools protocol and writes every websocket frame and every pub-api response
to tools/yahoo/dump. Everything known about Yahoo's draft protocol was read out
of captures this produced, and everything still unknown is in
docs/yahoo-draft-protocol.md waiting for another one.

The fiddly part is the browser, and it is the reason this script exists. Edge
and Chrome from version 136 ignore --remote-debugging-port on their default
profile: the port simply never opens, with no error and no warning. Passing an
explicit --user-data-dir re-enables it, and has the happy side effect of leaving
your real profile alone.

That separate profile starts logged out. Sign into Yahoo once in the window this
opens; it persists, so later runs need no login.

ORDER MATTERS. Start this before the draft room loads. The picks arrive over a
socket that opens with the room, and a recorder attached afterwards has already
missed the connect burst, which is where the settings, the draft order and the
seat states are sent. Start this, then join the mock from the lobby in the
window it opened.

Nothing is sent anywhere. It reads the debugging port on loopback and writes to
disk. It never touches cookies: the browser attaches those itself, which is the
whole reason this works without an API key.

.PARAMETER Port
The DevTools port. Defaults to 9222, or $env:CDP_PORT if that is set. A browser
already answering on it is used as it is, rather than a second one being opened.

.PARAMETER Browser
Path to the browser to launch. Defaults to Edge, then Chrome, whichever is
installed.

.EXAMPLE
.\capture.ps1
Open the debug browser if it is not already up, then record until Ctrl-C.

.EXAMPLE
.\capture.ps1 -Port 9333
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port,

    [string]$Browser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

$watcher = Join-Path $PSScriptRoot 'tools/yahoo/cdp-watch.mjs'
if (-not (Test-Path -LiteralPath $watcher)) {
    # Not a wrong working directory. `tools/` is ignored by git, so the watcher
    # exists only on a machine it was written on and a fresh clone has this
    # script and nothing for it to run.
    $missing = "Cannot find $watcher. The tools directory is not in the "
    $missing += 'repository - see .gitignore - so the watcher is local to '
    $missing += 'whoever made it.'
    throw $missing
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'node is not on PATH. This project needs Node ^20.19.0 or >=22.12.0.'
}

if (-not $PSBoundParameters.ContainsKey('Port')) {
    $Port = if ($env:CDP_PORT) { [int]$env:CDP_PORT } else { 9222 }
}

# The endpoint the watcher itself asks for. Answering here means a browser is up
# with debugging actually enabled, which is a different question from a browser
# being open.
function Get-DebugBrowser {
    param([int]$Port)
    try {
        return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    } catch {
        return $null
    }
}

# What that endpoint calls itself, when it says. Read defensively: strict mode
# makes a missing property an error, and this is only a line of reassurance.
function Get-BrowserName {
    param($Version)
    if ($Version -and $Version.PSObject.Properties['Browser']) { return $Version.Browser }
    return 'a browser'
}

$found = Get-DebugBrowser -Port $Port

if ($found) {
    Write-Information "Attaching to the browser already on port $Port."
} else {
    if (-not $Browser) {
        $candidates = @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
        )
        $Browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $Browser) {
        throw 'No Edge or Chrome found. Pass one with -Browser.'
    }

    # Its own profile, for the two reasons in the description: without it the
    # port never opens, and with it your real browser is left alone.
    $profileDir = Join-Path $env:TEMP 'edge-draft-debug'
    Write-Information "Opening $(Split-Path -Leaf $Browser) on port $Port, profile $profileDir"
    Start-Process -FilePath $Browser -ArgumentList @(
        "--remote-debugging-port=$Port",
        "--user-data-dir=$profileDir"
    )

    $deadline = (Get-Date).AddSeconds(30)
    while (-not ($found = Get-DebugBrowser -Port $Port) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
    if (-not $found) {
        $help = 'Nothing answered on the debugging port within 30s. If the browser opened '
        $help += 'but the port did not, it is running on its default profile: close every '
        $help += 'window of it and run this again.'
        throw $help
    }
    Write-Information 'Sign into Yahoo in that window if it is not signed in already.'
}

Write-Information "  $(Get-BrowserName -Version $found)"
Write-Information ''
Write-Information 'Recording. Join the draft from the lobby in that window, and leave this running.'
Write-Information 'Frames are written as they arrive, to tools/yahoo/dump. Ctrl-C when you are done.'
Write-Information ''

$env:CDP_PORT = $Port
& node $watcher
exit $LASTEXITCODE
