# install.ps1 — vaultpilot-mcp PowerShell installer for Windows x64.
#
# Plan 10-02 (DIST-41). Windows analog to install.sh.
#
# Ships AS release asset via Plan 10-01 release.yml `cp ../install.ps1
# release-assets/` step. The iwr-pipe URL points at the versioned +
# immutable /releases/latest/download/install.ps1, NOT the mutable main
# branch raw file.
#
# Mandatory invariants:
#   1. $ErrorActionPreference = 'Stop'         — PowerShell equivalent of set -e
#   2. Invoke-VaultPilotInstall function wrap   — partial-download safety (T-PARTIAL-DOWNLOAD-1)
#   3. Invoke-WebRequest -UseBasicParsing       — no IE engine dep
#   4. Get-FileHash -Algorithm SHA256 BEFORE Expand-Archive — T-SHA256-VERIFY-BEFORE-EXTRACT-1
#   5. Idempotency via existing-binary --version check
#   6. SmartScreen Unblock-File workaround NOTICE — T-WINDOWS-SMARTSCREEN-1 accepted residual
#   7. PATH-append via HKEY_CURRENT_USER\Environment  (User scope; no admin)
#   8. Refusal for Windows-arm64 + unsupported arches → use 'npm install -g vaultpilot-mcp'
#
# Source: https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/blob/main/install.ps1
#
# Usage:
#   iwr -useb https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/install.ps1 | iex
#
# Env vars:
#   VAULTPILOT_MCP_VERSION       pin a specific version (default: latest)
#   VAULTPILOT_MCP_INSTALL_DIR   install dir (default: %LOCALAPPDATA%\vaultpilot-mcp\bin)
#   VAULTPILOT_MCP_NO_SETUP=1    skip MCP client registration after install
#   VAULTPILOT_MCP_AUTO=1        non-interactive: assume Y to all prompts
#   VAULTPILOT_MCP_JSON=1        emit InstallEnvelope JSON to stdout

$ErrorActionPreference = 'Stop'

function Write-VpInfo { param([string]$Message) Write-Host "[install.ps1] $Message" }
function Write-VpWarn { param([string]$Message) Write-Warning "[install.ps1] $Message" }

function Invoke-RegisterMcpClients {
    param([string]$BinaryPath)
    # Per Plan 10-03 surface: `vaultpilot-mcp setup --non-interactive --json`
    # accepts a JSON payload on stdin. Non-fatal — user can re-run manually.
    Write-VpInfo "Registering with detected MCP clients via $BinaryPath setup..."
    try {
        $payload = '{"registerWith":["claude-code","claude-desktop","cursor"]}'
        $payload | & $BinaryPath setup --non-interactive --json
    } catch {
        Write-VpWarn "MCP client registration failed (non-fatal). Run '$BinaryPath setup' manually to retry."
    }
}

function Write-InstallEnvelope {
    param(
        [string]$Status,
        [array]$Checks  # array of [pscustomobject]@{id; level; message}
    )
    $envelope = [ordered]@{
        envelope_version = 1
        status           = $Status
        checks           = $Checks
    }
    # Minimal stdout JSON (mirrors install.sh raw-printf emit; v1.4 ergonomic
    # limitation per RESEARCH § Topic 9 line 960 — v1.4.1+ routes through the
    # installed binary's --emit-install-envelope flag).
    $envelope | ConvertTo-Json -Compress -Depth 4 | Write-Output
}

function Invoke-VaultPilotInstall {
    param(
        [string]$Version    = $(if ($env:VAULTPILOT_MCP_VERSION) { $env:VAULTPILOT_MCP_VERSION } else { 'latest' }),
        [string]$InstallDir = $(if ($env:VAULTPILOT_MCP_INSTALL_DIR) { $env:VAULTPILOT_MCP_INSTALL_DIR } else { "$env:LOCALAPPDATA\vaultpilot-mcp\bin" }),
        [switch]$Json       = ($env:VAULTPILOT_MCP_JSON -eq '1'),
        [switch]$Auto       = ($env:VAULTPILOT_MCP_AUTO -eq '1'),
        [switch]$NoSetup    = ($env:VAULTPILOT_MCP_NO_SETUP -eq '1')
    )

    # ── Arch detect via .NET RuntimeInformation (Windows-arm64 refusal) ──
    $archEnum = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    if ($archEnum -eq 'Arm64') {
        Write-Error "Unsupported platform windows-arm64. Use 'npm install -g vaultpilot-mcp' for Windows arm64."
        exit 1
    }
    if ($archEnum -ne 'X64') {
        Write-Error "Unsupported arch: $archEnum. Use 'npm install -g vaultpilot-mcp' for Windows $archEnum."
        exit 1
    }

    $archiveFilename = "vaultpilot-mcp-$Version-windows-x64.zip"
    $archiveUrl = if ($Version -eq 'latest') {
        "https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/$archiveFilename"
    } else {
        "https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/download/$Version/$archiveFilename"
    }
    $sha256Url = "$archiveUrl.sha256"

    Write-VpInfo "Detected platform: windows-x64"
    Write-VpInfo "Target archive:    $archiveFilename"
    Write-VpInfo "Install directory: $InstallDir"

    # ── Idempotency check ─────────────────────────────────────────────────
    $binaryPath = Join-Path $InstallDir "vaultpilot-mcp.exe"
    if (Test-Path $binaryPath) {
        try {
            $existing = (& $binaryPath --version 2>$null).Trim()
        } catch {
            $existing = "unknown"
        }
        $targetClean = $Version.TrimStart('v')
        if ($existing -eq $targetClean) {
            Write-VpInfo "vaultpilot-mcp $Version already installed at $binaryPath — skipping download."
            if (-not $NoSetup) { Invoke-RegisterMcpClients $binaryPath }
            if ($Json) {
                Write-InstallEnvelope -Status 'ok' -Checks @(
                    [pscustomobject]@{ id='binary-download'; level='ok'; message='idempotent: already installed' }
                    [pscustomobject]@{ id='binary-install';  level='ok'; message='idempotent: already installed' }
                )
            }
            return
        }
    }

    # ── Download + SHA-256 verify BEFORE Expand-Archive ───────────────────
    $tmpDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "vaultpilot-mcp-$(Get-Random)") -Force
    try {
        $archivePath = Join-Path $tmpDir.FullName $archiveFilename
        $sha256Path  = "$archivePath.sha256"

        Write-VpInfo "Downloading $archiveFilename..."
        Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $archivePath
        Invoke-WebRequest -UseBasicParsing -Uri $sha256Url  -OutFile $sha256Path

        Write-VpInfo "Verifying SHA-256..."
        $expected = ((Get-Content $sha256Path -Raw) -split '\s+')[0].Trim().ToLower()
        $actual   = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLower()
        if ($expected -ne $actual) {
            throw "SHA-256 mismatch — refusing to install. Retry, or report at https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues"
        }

        # ── Extract + install ─────────────────────────────────────────────
        Write-VpInfo "Extracting + installing to $InstallDir..."
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Expand-Archive -Path $archivePath -DestinationPath $InstallDir -Force

        # ── SmartScreen NOTICE (T-WINDOWS-SMARTSCREEN-1 accepted residual) ─
        Write-Host ""
        Write-Host "==> Windows SmartScreen notice:"
        Write-Host "    vaultpilot-mcp v1.4 ships unsigned. SmartScreen may show 'Windows protected your PC' on first run."
        Write-Host "    Workaround: right-click -> Properties -> Unblock, OR run:"
        Write-Host "        Unblock-File -Path `"$binaryPath`""
        Write-Host ""

        # ── PATH-append via HKEY_CURRENT_USER\Environment (User scope; no admin) ─
        $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
        $pathPresence = 'ok'
        if ($userPath -notlike "*$InstallDir*") {
            [Environment]::SetEnvironmentVariable('PATH', "$userPath;$InstallDir", 'User')
            Write-VpInfo "Added $InstallDir to user PATH (open a new shell to take effect)."
            $pathPresence = 'ok'
        }

        if (-not $NoSetup) { Invoke-RegisterMcpClients $binaryPath }

        if ($Json) {
            Write-InstallEnvelope -Status 'ok' -Checks @(
                [pscustomobject]@{ id='binary-download'; level='ok';   message="downloaded $archiveFilename" }
                [pscustomobject]@{ id='binary-install';  level='ok';   message="installed to $binaryPath" }
                [pscustomobject]@{ id='path-presence';   level=$pathPresence; message="$InstallDir appended to user PATH" }
                [pscustomobject]@{ id='quarantine-attr'; level='ok';   message='n/a (Windows uses SmartScreen Unblock-File workaround)' }
            )
        }

        Write-VpInfo "Install complete."
    } finally {
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Invoke-VaultPilotInstall
