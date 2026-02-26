#!/bin/bash
# ============================================================
# init.sh — Selvia AI Orchestrator: Full Environment Setup
# ============================================================
# Usage:
#   ./init.sh [OPTIONS]
#
# Options:
#   --skip-n8n       Skip n8n startup
#   --skip-workflows Skip workflow import
#   --yes / -y       Auto-confirm prompts
#   --help / -h      Show this help message
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
N8N_PORT="${N8N_PORT:-5678}"
N8N_URL="http://localhost:${N8N_PORT}"
ENV_FILE="${SCRIPT_DIR}/env.sh"
ENV_TEMPLATE="${SCRIPT_DIR}/env.template.sh"

# Workflow files to import (active agents)
WORKFLOWS=(
    "${REPO_ROOT}/src/shopify_chat_agent/workflow-webhook.json"
    "${REPO_ROOT}/src/local_chat_agent/workflow-webhook.json"
)

# Colors
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

# CLI flags
SKIP_N8N=false
SKIP_WORKFLOWS=false
AUTO_YES=false

# ────────────────────────────────────────────────────────────
# Parse CLI flags
# ────────────────────────────────────────────────────────────
usage() {
    cat <<'USAGE'
Usage: ./init.sh [OPTIONS]

Initialize the Selvia AI Orchestrator development environment.

Options:
  --skip-n8n        Skip n8n startup
  --skip-workflows  Skip workflow import
  --yes, -y         Auto-confirm prompts
  --help, -h        Show this help message

Examples:
  ./init.sh              # Full setup
  ./init.sh --skip-n8n   # Skip n8n, just validate env
  ./init.sh -y           # Auto-confirm all prompts
USAGE
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-n8n)       SKIP_N8N=true; shift ;;
        --skip-workflows) SKIP_WORKFLOWS=true; shift ;;
        --yes|-y)         AUTO_YES=true; shift ;;
        --help|-h)        usage ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            echo "Run './init.sh --help' for usage." >&2
            exit 1
            ;;
    esac
done

# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────
info()   { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()     { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()   { echo -e "${RED}[FAIL]${NC}  $*"; }
header() { echo ""; echo -e "${BOLD}── $* ──${NC}"; }

confirm() {
    if $AUTO_YES; then return 0; fi
    local prompt="${1:-Continue?}"
    read -r -p "$(echo -e "${YELLOW}${prompt} [y/N]: ${NC}")" ans
    case "$ans" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

command_exists() { command -v "$1" &>/dev/null; }

# ────────────────────────────────────────────────────────────
# 1. Check prerequisites
# ────────────────────────────────────────────────────────────
check_prerequisites() {
    header "Checking prerequisites"
    local errors=0

    if command_exists node; then
        local node_ver major
        node_ver="$(node --version)"
        major="$(echo "$node_ver" | sed 's/^v//' | cut -d. -f1)"
        if (( major >= 18 )); then
            ok "Node.js ${node_ver}"
        else
            fail "Node.js ${node_ver} — need >= v18.0.0"
            errors=$((errors + 1))
        fi
    else
        fail "Node.js not found"
        errors=$((errors + 1))
    fi

    if command_exists npx; then
        ok "npx available"
    else
        fail "npx not found"
        errors=$((errors + 1))
    fi

    if command_exists curl; then
        ok "curl available"
    else
        fail "curl not found"
        errors=$((errors + 1))
    fi

    if (( errors > 0 )); then
        fail "${errors} prerequisite(s) missing"
        exit 1
    fi
}

# ────────────────────────────────────────────────────────────
# 2. Setup environment variables
# ────────────────────────────────────────────────────────────
setup_env() {
    header "Setting up environment"

    if [[ ! -f "$ENV_FILE" ]]; then
        if [[ -f "$ENV_TEMPLATE" ]]; then
            info "Creating env.sh from template..."
            cp "$ENV_TEMPLATE" "$ENV_FILE"
            chmod +x "$ENV_FILE"
            warn "env.sh created with placeholder values."
            warn "Edit ${ENV_FILE} and fill in your credentials."
            if ! $AUTO_YES; then
                echo ""
                read -r -p "$(echo -e "${YELLOW}Press Enter after editing env.sh (or Ctrl+C to abort)...${NC}")"
            fi
        else
            fail "No env.sh or env.template.sh found"
            exit 1
        fi
    fi

    # Validate for placeholders
    local placeholders=0
    while IFS= read -r line; do
        if [[ "$line" =~ ^export\ ([A-Z0-9_]+)= ]] && [[ "$line" == *"REPLACE_ME"* ]]; then
            placeholders=$((placeholders + 1))
        fi
    done < "$ENV_FILE"

    if (( placeholders > 0 )); then
        warn "${placeholders} variable(s) still have REPLACE_ME values"
        if ! confirm "Continue anyway?"; then
            exit 0
        fi
    else
        ok "env.sh configured"
    fi

    # Source it
    info "Sourcing env.sh..."
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    ok "Environment loaded"
}

# ────────────────────────────────────────────────────────────
# 3. Install/check n8n
# ────────────────────────────────────────────────────────────
check_n8n() {
    header "Checking n8n"

    local npx_cache_dir
    npx_cache_dir="$(npm config get cache 2>/dev/null || echo "$HOME/.npm")/_npx"

    if [[ -d "$npx_cache_dir" ]] && find "$npx_cache_dir" -path "*/n8n/bin/*" -name "n8n" 2>/dev/null | grep -q .; then
        ok "n8n cached in npx"
    else
        info "n8n not cached. Downloading (first-time only)..."
        npx n8n --version
        ok "n8n downloaded"
    fi
}

# ────────────────────────────────────────────────────────────
# 4. Start n8n
# ────────────────────────────────────────────────────────────
start_n8n() {
    header "Starting n8n"

    # Check if already running
    if curl -sf "${N8N_URL}/healthz" &>/dev/null; then
        ok "n8n already running at ${N8N_URL}"
        return 0
    fi

    info "Starting n8n in background..."
    nohup npx n8n start > "${SCRIPT_DIR}/n8n.log" 2>&1 &
    local n8n_pid=$!
    echo "$n8n_pid" > "${SCRIPT_DIR}/n8n.pid"
    info "n8n PID: ${n8n_pid}"

    # Wait for health
    info "Waiting for n8n to be ready..."
    local max_wait=60 waited=0
    while (( waited < max_wait )); do
        if curl -sf "${N8N_URL}/healthz" &>/dev/null; then
            ok "n8n is healthy"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
        printf "."
    done
    echo ""
    fail "n8n did not start within ${max_wait}s. Check ${SCRIPT_DIR}/n8n.log"
    return 1
}

# ────────────────────────────────────────────────────────────
# 5. Import workflows
# ────────────────────────────────────────────────────────────
import_workflows() {
    header "Importing workflows from src/"

    for workflow in "${WORKFLOWS[@]}"; do
        if [[ -f "$workflow" ]]; then
            local name
            name="$(basename "$(dirname "$workflow")")/$(basename "$workflow")"
            info "Importing: $name"
            if npx n8n import:workflow --input="$workflow" 2>/dev/null; then
                ok "Imported: $name"
            else
                warn "Could not import $name (may already exist)"
            fi
        else
            warn "Workflow not found: $workflow"
        fi
    done
}

# ────────────────────────────────────────────────────────────
# 6. Check Claude Code
# ────────────────────────────────────────────────────────────
check_claude() {
    header "Claude Code setup"

    if [[ -f "${REPO_ROOT}/CLAUDE.md" ]]; then
        ok "CLAUDE.md found at repo root"
        info "Claude Code will auto-load guidance from CLAUDE.md"
    else
        warn "CLAUDE.md not found at repo root"
    fi

    if command_exists claude; then
        ok "Claude Code CLI installed: $(claude --version 2>/dev/null || echo 'available')"
    else
        info "Claude Code CLI not installed. Install with:"
        info "  npm install -g @anthropic-ai/claude-code"
    fi
}

# ────────────────────────────────────────────────────────────
# 7. Print summary
# ────────────────────────────────────────────────────────────
print_summary() {
    header "Setup Complete"

    echo ""
    echo "  n8n UI:      ${N8N_URL}"
    echo "  n8n log:     ${SCRIPT_DIR}/n8n.log"
    echo "  CLAUDE.md:   ${REPO_ROOT}/CLAUDE.md"
    echo ""
    echo "  To stop n8n:"
    echo "    kill \$(cat ${SCRIPT_DIR}/n8n.pid)"
    echo ""
    echo "  To run Claude Code:"
    echo "    cd ${REPO_ROOT} && claude"
    echo ""

    ok "Ready to develop!"
}

# ════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════
main() {
    echo ""
    echo -e "${BOLD}Selvia AI Orchestrator — Init${NC}"
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    check_prerequisites
    setup_env

    if ! $SKIP_N8N; then
        check_n8n
        start_n8n
    else
        info "Skipping n8n (--skip-n8n)"
    fi

    if ! $SKIP_N8N && ! $SKIP_WORKFLOWS; then
        import_workflows
    fi

    check_claude
    print_summary
}

main "$@"
