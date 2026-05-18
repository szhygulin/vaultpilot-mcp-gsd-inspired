#!/usr/bin/env bash
# install.sh — vaultpilot-mcp curl-pipe-to-bash installer.
#
# Plan 10-02 (DIST-41). FIRST shell script in repo.
#
# Ships AS release asset via Plan 10-01 release.yml `cp ../install.sh
# release-assets/` step. The curl-pipe URL points at the versioned +
# immutable /releases/latest/download/install.sh, NOT the mutable main
# branch raw file. A main-branch update to install.sh does NOT change
# curl-pipe behavior until the next tagged release — accepted v1.4
# behavior.
#
# Mandatory invariants (RESEARCH § Topic 5 Pitfalls):
#   1. set -euo pipefail                — exit on non-zero / unset / pipe failure
#   2. main() { … }; main "$@"          — arp242 partial-download safety idiom
#   3. curl -fsSL                       — TLS-only + fail-fast on 4xx/5xx
#   4. SHA-256 verify BEFORE extract    — T-SHA256-VERIFY-BEFORE-EXTRACT-1
#   5. Idempotency via --version check  — skip download when binary matches
#   6. macOS Gatekeeper interactive OFFER — auto-mode prints NOTICE + skips
#   7. PATH check warn-only             — never auto-edit shell rc (invasive)
#   8. Refusal arms                     — linux-arm64 / Windows / unknown →
#                                          use 'npm install -g vaultpilot-mcp'
#
# Source: https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/blob/main/install.sh
#
# Usage:
#   curl -fsSL https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/install.sh | bash
#
# Env vars:
#   VAULTPILOT_MCP_VERSION       pin a specific version (default: latest)
#   VAULTPILOT_MCP_INSTALL_DIR   install dir (default: ~/.local/bin)
#   VAULTPILOT_MCP_NO_SETUP=1    skip MCP client registration after install
#   VAULTPILOT_MCP_AUTO=1        non-interactive: assume Y to all prompts
#   VAULTPILOT_MCP_JSON=1        emit InstallEnvelope JSON to stdout
#   VAULTPILOT_MCP_DRY_RUN=1     resolve URL + arch only; skip download/install

set -euo pipefail

# ── Logging helpers (all go to stderr; stdout is reserved for --json envelope) ─

log_info() { printf "[install.sh] %s\n" "$*" >&2; }
log_warn() { printf "[install.sh] WARN: %s\n" "$*" >&2; }
fail()     { printf "[install.sh] ERROR: %s\n" "$*" >&2; exit 1; }

# ── OS + arch detection (RESEARCH § Topic 5.1 lines 415-432) ────────────────

detect_os() {
  case "$(uname -s)" in
    Linux*)               echo "linux" ;;
    Darwin*)              echo "macos" ;;
    CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
    *) fail "Unsupported OS: $(uname -s). Use 'npm install -g vaultpilot-mcp' instead." ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) fail "Unsupported arch: $(uname -m). Use 'npm install -g vaultpilot-mcp' instead." ;;
  esac
}

refuse_unsupported() {
  # $1=os $2=arch $3=remediation
  fail "Unsupported platform $1-$2. $3"
}

# ── Interactive prompts ─────────────────────────────────────────────────────

confirm_overwrite() {
  # $1=existing_version $2=target_version
  if [[ "${VAULTPILOT_MCP_AUTO:-0}" == "1" ]]; then
    log_info "Overwriting $1 with $2 (auto mode)."
    return 0
  fi
  read -r -p "Overwrite $1 with $2? [y/N] " response
  [[ "$response" =~ ^[Yy]$ ]]
}

offer_strip_quarantine() {
  # $1=binary_path $2=auto_mode  (T-MACOS-QUARANTINE-1 accepted residual)
  local binary_path="$1" auto_mode="$2"
  printf "\n==> macOS Gatekeeper notice:\n" >&2
  printf "    vaultpilot-mcp v1.4 ships unsigned.\n" >&2
  printf "    First run will trigger 'cannot be opened because the developer cannot be verified.'\n" >&2
  printf "    To remove the quarantine attribute now (one-time):\n" >&2
  printf "        xattr -d com.apple.quarantine %s\n\n" "$binary_path" >&2

  if [[ "$auto_mode" == "1" ]]; then
    printf "    [auto mode — skipping prompt; user runs xattr -d manually]\n\n" >&2
    return 0
  fi

  read -r -p "    Run xattr -d com.apple.quarantine now? [y/N] " response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    xattr -d com.apple.quarantine "$binary_path" 2>/dev/null || true  # attr may not be set
    log_info "Quarantine attribute stripped."
  fi
}

# ── MCP client registration (delegated to installed binary's setup) ─────────

register_with_mcp_clients_and_maybe_setup() {
  # $1=binary_path
  local binary_path="$1"
  log_info "Registering with detected MCP clients via $binary_path setup..."
  # Per Plan 10-03 surface: `vaultpilot-mcp setup --non-interactive --json`
  # accepts a JSON payload on stdin. Non-fatal if it fails — user can re-run
  # `<binary_path> setup` manually.
  printf '{"registerWith":["claude-code","claude-desktop","cursor"]}' \
    | "$binary_path" setup --non-interactive --json \
    || log_warn "MCP client registration failed (non-fatal). Run '$binary_path setup' manually to retry."
}

# ── --json envelope emit (v1.4 raw printf; v1.4.1+ routes through binary) ───

maybe_emit_envelope() {
  # $1=json_mode $2=status ($3...$N=optional check triplets "id|level|message")
  local json_mode="$1" status="$2"
  shift 2 || true
  if [[ "$json_mode" != "1" ]]; then return 0; fi

  # v1.4 ergonomic limitation per RESEARCH § Topic 9 line 960: install.sh
  # builds the JSON envelope via printf "%s" against pre-constructed strings.
  # The `vaultpilot-mcp setup --emit-install-envelope` flag is v1.4.1+.
  printf '{"envelope_version":1,"status":"%s","checks":[' "$status"
  local sep="" check id level message
  for check in "$@"; do
    id="${check%%|*}"
    level="${check#*|}"; level="${level%%|*}"
    message="${check#*|*|}"
    # Minimal JSON-string escape: backslash + double-quote (defensive — our
    # message strings are static literals built by this script, not user
    # input, so this is belt-and-braces).
    message="${message//\\/\\\\}"
    message="${message//\"/\\\"}"
    printf '%s{"id":"%s","level":"%s","message":"%s"}' "$sep" "$id" "$level" "$message"
    sep=","
  done
  printf ']}\n'
}

# ── main wrap (T-PARTIAL-DOWNLOAD-1 — arp242 idiom; RESEARCH § Topic 5/438) ─

main() {
  local version="${VAULTPILOT_MCP_VERSION:-latest}"
  local install_dir="${VAULTPILOT_MCP_INSTALL_DIR:-$HOME/.local/bin}"
  local json_mode="${VAULTPILOT_MCP_JSON:-0}"
  local auto_mode="${VAULTPILOT_MCP_AUTO:-0}"
  local dry_run="${VAULTPILOT_MCP_DRY_RUN:-0}"

  # ── OS + arch detection ─────────────────────────────────────────────────
  local os arch
  os="$(detect_os)"
  arch="$(detect_arch)"

  # ── Refusal arms (linux-arm64, Windows, unknown) ────────────────────────
  if [[ "$os" == "linux" && "$arch" == "arm64" ]]; then
    refuse_unsupported "$os" "$arch" "Use 'npm install -g vaultpilot-mcp' for Linux arm64."
  fi
  if [[ "$os" == "windows" ]]; then
    refuse_unsupported "$os" "$arch" "Windows: use install.ps1 via 'iwr -useb https://… | iex' instead."
  fi

  # ── Resolve version → download URL ──────────────────────────────────────
  local archive_filename="vaultpilot-mcp-${version}-${os}-${arch}.tar.gz"
  local archive_url sha256_url
  if [[ "$version" == "latest" ]]; then
    archive_url="https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/${archive_filename}"
  else
    archive_url="https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/download/${version}/${archive_filename}"
  fi
  sha256_url="${archive_url}.sha256"

  log_info "Detected platform: ${os}-${arch}"
  log_info "Target archive:    ${archive_filename}"
  log_info "Install directory: ${install_dir}"

  if [[ "$dry_run" == "1" ]]; then
    log_info "Dry-run mode (VAULTPILOT_MCP_DRY_RUN=1) — would download from:"
    log_info "    ${archive_url}"
    log_info "    ${sha256_url}"
    maybe_emit_envelope "$json_mode" "ok" \
      "binary-download|ok|dry-run: skipped download" \
      "binary-install|ok|dry-run: skipped install" \
      "path-presence|ok|dry-run: skipped PATH check" \
      "quarantine-attr|ok|dry-run: skipped quarantine handling"
    return 0
  fi

  # ── Idempotency check ──────────────────────────────────────────────────
  if [[ -f "$install_dir/vaultpilot-mcp" ]]; then
    local existing_version
    existing_version="$("$install_dir/vaultpilot-mcp" --version 2>/dev/null || echo "unknown")"
    if [[ "$existing_version" == "${version#v}" ]]; then
      log_info "vaultpilot-mcp ${version} already installed at ${install_dir}/vaultpilot-mcp — skipping download."
      if [[ "${VAULTPILOT_MCP_NO_SETUP:-0}" != "1" ]]; then
        register_with_mcp_clients_and_maybe_setup "$install_dir/vaultpilot-mcp"
      fi
      maybe_emit_envelope "$json_mode" "ok" \
        "binary-download|ok|idempotent: already installed" \
        "binary-install|ok|idempotent: already installed"
      return 0
    fi
    confirm_overwrite "$existing_version" "$version" || exit 1
  fi

  # ── Download + SHA-256 verify BEFORE extract (T-SHA256-VERIFY-BEFORE-EXTRACT-1) ─
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  log_info "Downloading ${archive_filename}..."
  curl -fsSL "$archive_url" -o "$tmp_dir/$archive_filename"
  curl -fsSL "$sha256_url"  -o "$tmp_dir/$archive_filename.sha256"

  log_info "Verifying SHA-256..."
  ( cd "$tmp_dir" && shasum -a 256 -c "$archive_filename.sha256" >/dev/null ) \
    || fail "SHA-256 mismatch — refusing to install. Retry, or report at https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues"

  # ── Extract + install ──────────────────────────────────────────────────
  log_info "Extracting + installing to ${install_dir}..."
  mkdir -p "$install_dir"
  tar xzf "$tmp_dir/$archive_filename" -C "$tmp_dir"
  # pkg produces files named vaultpilot-mcp-linux / vaultpilot-mcp-macos-x64 /
  # vaultpilot-mcp-macos-arm64 (per Plan 10-01 release.yml). The glob below
  # is unambiguous inside the extracted tmp dir.
  local extracted
  extracted="$(find "$tmp_dir" -maxdepth 1 -name "vaultpilot-mcp-*" -type f | head -n 1)"
  if [[ -z "$extracted" ]]; then
    fail "Could not find extracted binary in ${tmp_dir} — archive layout unexpected."
  fi
  mv "$extracted" "$install_dir/vaultpilot-mcp"
  chmod +x "$install_dir/vaultpilot-mcp"

  # ── macOS Gatekeeper OFFER (quarantine-attr check) ─────────────────────
  if [[ "$os" == "macos" ]]; then
    offer_strip_quarantine "$install_dir/vaultpilot-mcp" "$auto_mode"
  fi

  # ── PATH check (warn-only — T-PATH-AUTO-EDIT-1) ────────────────────────
  if ! echo ":$PATH:" | grep -q ":$install_dir:"; then
    log_warn "$install_dir is NOT on your \$PATH. Add: export PATH=\"$install_dir:\$PATH\""
  fi

  # ── MCP client auto-register (delegated to installed binary) ───────────
  if [[ "${VAULTPILOT_MCP_NO_SETUP:-0}" != "1" ]]; then
    register_with_mcp_clients_and_maybe_setup "$install_dir/vaultpilot-mcp"
  fi

  # ── Emit InstallEnvelope JSON (RESEARCH § Topic 9 sample) ──────────────
  maybe_emit_envelope "$json_mode" "ok" \
    "binary-download|ok|downloaded ${archive_filename}" \
    "binary-install|ok|installed to ${install_dir}/vaultpilot-mcp" \
    "path-presence|ok|${install_dir} on \$PATH" \
    "quarantine-attr|ok|handled per platform"

  log_info "Install complete."
}

main "$@"
