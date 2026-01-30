#!/usr/bin/env bash
# ============================================================
# bootstrap.sh — Shopify n8n Chat Workflow: Full Local Setup
# ============================================================
# Usage:
#   ./bootstrap.sh [OPTIONS]
#
# Options:
#   --skip-tests     Skip test execution
#   --skip-n8n       Skip n8n install and startup
#   --tests-only     Only run tests (skip all setup)
#   --yes / -y       Auto-confirm prompts
#   --help / -h      Show this help message
# ============================================================

set -euo pipefail

# ────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N8N_PORT=5678
N8N_URL="http://localhost:${N8N_PORT}"
HEALTHZ_URL="${N8N_URL}/healthz"
ENV_FILE="${SCRIPT_DIR}/env.sh"
WORKFLOW_JSON="${SCRIPT_DIR}/shopify-product-chat-workflow-2.json"
MIN_NODE_MAJOR=18

# Colors (no-op if not a terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

# ────────────────────────────────────────────────────────────
# CLI flag defaults
# ────────────────────────────────────────────────────────────
SKIP_TESTS=false
SKIP_N8N=false
TESTS_ONLY=false
AUTO_YES=false

# ────────────────────────────────────────────────────────────
# 1. Parse CLI flags
# ────────────────────────────────────────────────────────────
usage() {
    cat <<'USAGE'
Usage: ./bootstrap.sh [OPTIONS]

Bootstrap the Shopify n8n Chat Workflow local dev environment.

Options:
  --skip-tests     Skip test execution
  --skip-n8n       Skip n8n install and startup
  --tests-only     Only run tests (skip all setup)
  --yes, -y        Auto-confirm prompts
  --help, -h       Show this help message

Examples:
  ./bootstrap.sh                  # Full setup + tests
  ./bootstrap.sh --skip-tests     # Setup only, no tests
  ./bootstrap.sh --tests-only     # Run tests only
  ./bootstrap.sh -y               # Full setup, auto-confirm
USAGE
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-tests)  SKIP_TESTS=true; shift ;;
        --skip-n8n)    SKIP_N8N=true; shift ;;
        --tests-only)  TESTS_ONLY=true; shift ;;
        --yes|-y)      AUTO_YES=true; shift ;;
        --help|-h)     usage ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            echo "Run './bootstrap.sh --help' for usage." >&2
            exit 1
            ;;
    esac
done

# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }
header() {
    echo ""
    echo -e "${BOLD}── $* ──${NC}"
}

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
# 2. Check prerequisites
# ────────────────────────────────────────────────────────────
check_prerequisites() {
    header "Checking prerequisites"
    local errors=0

    # Node.js
    if command_exists node; then
        local node_ver
        node_ver="$(node --version)"
        local major
        major="$(echo "$node_ver" | sed 's/^v//' | cut -d. -f1)"
        if (( major >= MIN_NODE_MAJOR )); then
            ok "Node.js ${node_ver}"
        else
            fail "Node.js ${node_ver} — need >= v${MIN_NODE_MAJOR}.0.0"
            errors=$((errors + 1))
        fi
    else
        fail "Node.js not found. Install from https://nodejs.org/ or: nvm install 18"
        errors=$((errors + 1))
    fi

    # npm
    if command_exists npm; then
        ok "npm $(npm --version)"
    else
        fail "npm not found (should come with Node.js)"
        errors=$((errors + 1))
    fi

    # npx
    if command_exists npx; then
        ok "npx $(npx --version 2>/dev/null || echo 'available')"
    else
        fail "npx not found (should come with Node.js)"
        errors=$((errors + 1))
    fi

    # Python 3
    if command_exists python3; then
        ok "Python3 $(python3 --version 2>&1 | awk '{print $2}')"
    else
        warn "Python3 not found — Python test (test-e2e.py) will be skipped"
    fi

    # git
    if command_exists git; then
        ok "git $(git --version | awk '{print $3}')"
    else
        fail "git not found"
        errors=$((errors + 1))
    fi

    # curl
    if command_exists curl; then
        ok "curl $(curl --version | head -1 | awk '{print $2}')"
    else
        fail "curl not found"
        errors=$((errors + 1))
    fi

    # WSL detection
    if grep -qi microsoft /proc/version 2>/dev/null; then
        info "WSL detected"
        if [[ "$SCRIPT_DIR" == /mnt/c/* ]] || [[ "$SCRIPT_DIR" == /mnt/d/* ]]; then
            warn "Project is on a Windows mount (${SCRIPT_DIR})."
            warn "File I/O will be slower. Consider moving to ~/shopify-commit for better performance."
        fi
    fi

    if (( errors > 0 )); then
        fail "${errors} prerequisite(s) missing. Please install them before continuing."
        exit 1
    fi
    ok "All prerequisites met"
}

# ────────────────────────────────────────────────────────────
# 3. Install n8n
# ────────────────────────────────────────────────────────────
install_n8n() {
    header "Checking n8n"

    # Check if n8n is already in the npx cache
    local npx_cache_dir
    npx_cache_dir="$(npm config get cache 2>/dev/null || echo "$HOME/.npm")/_npx"

    local n8n_found=false
    if [[ -d "$npx_cache_dir" ]]; then
        if find "$npx_cache_dir" -path "*/n8n/bin/*" -name "n8n" 2>/dev/null | grep -q .; then
            n8n_found=true
        fi
    fi

    if $n8n_found; then
        ok "n8n already cached in npx"
        local n8n_ver
        n8n_ver="$(npx n8n --version 2>/dev/null || echo 'unknown')"
        info "n8n version: ${n8n_ver}"
    else
        info "n8n not found in npx cache. Priming cache (this downloads n8n)..."
        if npx n8n --version; then
            ok "n8n cached successfully"
        else
            fail "Failed to cache n8n via npx"
            exit 1
        fi
    fi
}

# ────────────────────────────────────────────────────────────
# 4. Install Claude Code
# ────────────────────────────────────────────────────────────
install_claude_code() {
    header "Checking Claude Code CLI"

    if command_exists claude; then
        ok "Claude Code already installed: $(claude --version 2>/dev/null || echo 'available')"
    else
        info "Claude Code CLI not found. Installing globally..."
        if npm install -g @anthropic-ai/claude-code 2>/dev/null; then
            ok "Claude Code installed"
        else
            warn "Claude Code install failed (non-fatal). Install manually:"
            warn "  npm install -g @anthropic-ai/claude-code"
        fi
    fi
}

# ────────────────────────────────────────────────────────────
# 5. Install test dependencies
# ────────────────────────────────────────────────────────────
install_test_deps() {
    header "Checking test dependencies"

    local ws_path="/tmp/node_modules/ws"
    if [[ -d "$ws_path" ]]; then
        ok "ws module already installed at /tmp/node_modules/"
    else
        info "Installing ws module to /tmp/node_modules/ (for WebSocket tests)..."
        (cd /tmp && npm install ws 2>/dev/null)
        if [[ -d "$ws_path" ]]; then
            ok "ws module installed"
        else
            warn "ws module install failed (WebSocket tests may fail)"
        fi
    fi
}

# ────────────────────────────────────────────────────────────
# 6. Create env.sh template
# ────────────────────────────────────────────────────────────
setup_env_file() {
    header "Checking env.sh"

    if [[ ! -f "$ENV_FILE" ]]; then
        info "Creating env.sh template..."
        cat > "$ENV_FILE" <<'ENVTEMPLATE'
#!/bin/bash
# ============================================================
# Shopify Chat Workflow - Environment Secrets
# ============================================================
# Source this file before running tests:
#   source env.sh
#
# DO NOT commit this file to version control.
# It is listed in .gitignore.
# ============================================================

# Groq LLM API key (used by test suites and n8n workflow)
# Get yours at: https://console.groq.com
export GROQ_API_KEY="REPLACE_ME"

# Shopify store
export SHOPIFY_STORE="your-store.myshopify.com"
export SHOPIFY_API_VERSION="2024-01"

# Shopify OAuth2 credentials (from your Shopify custom app)
export SHOPIFY_CLIENT_ID="REPLACE_ME"
export SHOPIFY_CLIENT_SECRET="REPLACE_ME"

# n8n local instance
export N8N_BASE="http://localhost:5678"
export N8N_EMAIL="your-email@example.com"
export N8N_PASSWORD="REPLACE_ME"

# n8n credential IDs (set after creating credentials in n8n UI)
export N8N_GROQ_HEADER_AUTH_ID="REPLACE_ME"
export N8N_SHOPIFY_OAUTH2_ID="REPLACE_ME"
ENVTEMPLATE
        chmod +x "$ENV_FILE"
        warn "env.sh created with placeholder values."
        warn "Edit ${ENV_FILE} and fill in your real credentials before continuing."
        if ! $AUTO_YES; then
            echo ""
            read -r -p "$(echo -e "${YELLOW}Press Enter after editing env.sh (or Ctrl+C to abort)...${NC}")"
        fi
    else
        info "env.sh already exists. Validating..."
    fi

    # Validate: check for placeholder values
    local placeholders=0
    local placeholder_vars=()
    while IFS= read -r line; do
        if [[ "$line" =~ ^export\ ([A-Z_]+)= ]] && [[ "$line" == *"REPLACE_ME"* ]]; then
            placeholder_vars+=("${BASH_REMATCH[1]}")
            placeholders=$((placeholders + 1))
        fi
    done < "$ENV_FILE"

    if (( placeholders > 0 )); then
        warn "${placeholders} variable(s) in env.sh still have placeholder values:"
        for v in "${placeholder_vars[@]}"; do
            warn "  - ${v}"
        done
        if ! confirm "Continue anyway?"; then
            info "Aborting. Edit env.sh and re-run bootstrap.sh."
            exit 0
        fi
    else
        ok "env.sh has no placeholder values"
    fi

    # Source it
    info "Sourcing env.sh..."
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    ok "Environment loaded"
}

# ────────────────────────────────────────────────────────────
# 7. Start n8n
# ────────────────────────────────────────────────────────────
start_n8n() {
    header "Starting n8n"

    # Check if already running on the port
    if curl -sf "${HEALTHZ_URL}" &>/dev/null; then
        ok "n8n is already running at ${N8N_URL}"
        return 0
    fi

    # Check if port is in use by something else
    if command_exists lsof; then
        if lsof -i ":${N8N_PORT}" &>/dev/null; then
            warn "Port ${N8N_PORT} is in use but /healthz didn't respond."
            warn "Another process may be using this port."
            if ! confirm "Try to start n8n anyway?"; then
                return 1
            fi
        fi
    fi

    info "Starting n8n in background..."
    nohup npx n8n start > /tmp/n8n-bootstrap.log 2>&1 &
    local n8n_pid=$!
    info "n8n PID: ${n8n_pid} (log: /tmp/n8n-bootstrap.log)"

    # Wait for healthz
    info "Waiting for n8n to become healthy..."
    local max_wait=60
    local waited=0
    while (( waited < max_wait )); do
        if curl -sf "${HEALTHZ_URL}" &>/dev/null; then
            ok "n8n is healthy at ${N8N_URL}"
            echo ""
            info "n8n UI: ${N8N_URL}"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
        printf "."
    done
    echo ""
    fail "n8n did not become healthy within ${max_wait}s."
    fail "Check log: /tmp/n8n-bootstrap.log"
    return 1
}

# ────────────────────────────────────────────────────────────
# 8. Apply n8n sort-by middleware patch
# ────────────────────────────────────────────────────────────
apply_sortby_patch() {
    header "Applying n8n sort-by middleware patch"

    local npx_cache_dir
    npx_cache_dir="$(npm config get cache 2>/dev/null || echo "$HOME/.npm")/_npx"

    # Find sort-by.js in the npx cache
    local sortby_file
    sortby_file="$(find "$npx_cache_dir" -path "*/list-query/sort-by.js" -type f 2>/dev/null | head -1)"

    if [[ -z "$sortby_file" ]]; then
        warn "Could not find sort-by.js in npx cache."
        warn "Patch skipped. Workflows using sortBy + sortOrder may not work correctly."
        return 0
    fi

    info "Found: ${sortby_file}"

    # Check if patch is already applied
    if grep -q "sortOrder" "$sortby_file"; then
        ok "Patch already applied"
        return 0
    fi

    # Find the insertion point: after "if (!sortBy) return next();"
    if ! grep -q "if (!sortBy) return next();" "$sortby_file"; then
        warn "Could not find expected insertion point in sort-by.js."
        warn "Patch skipped. The file may have a different structure."
        return 0
    fi

    info "Applying patch..."
    # Create backup
    cp "$sortby_file" "${sortby_file}.bak"

    # Insert the patch after the "if (!sortBy) return next();" line
    sed -i '/if (!sortBy) return next();/a\
    // [bootstrap.sh patch] merge sortBy + sortOrder query params\
    const { sortOrder } = req.query;\
    if (sortBy \&\& sortOrder \&\& typeof sortBy === '\''string'\'' \&\& !sortBy.includes('\'':'\'')) {\
        sortBy = sortBy + '\'':'\'' + sortOrder;\
        req.query.sortBy = sortBy;\
    }' "$sortby_file"

    if grep -q "sortOrder" "$sortby_file"; then
        ok "Patch applied successfully"
        info "Backup saved to: ${sortby_file}.bak"
    else
        fail "Patch application may have failed. Check ${sortby_file}"
        # Restore backup
        cp "${sortby_file}.bak" "$sortby_file"
        warn "Restored backup"
    fi
}

# ────────────────────────────────────────────────────────────
# 9. Print n8n setup instructions
# ────────────────────────────────────────────────────────────
print_n8n_instructions() {
    header "n8n Manual Setup Steps"

    cat <<INSTRUCTIONS

  The following steps must be done in the n8n UI (${N8N_URL}):

  ${BOLD}Step 1: Create n8n account${NC}
    - Open ${N8N_URL} in your browser
    - Create a local account (email + password)

  ${BOLD}Step 2: Create Groq Header Auth credential${NC}
    - Go to: Credentials > Add Credential > Header Auth
    - Name: "Header Auth account"
    - Header Name: Authorization
    - Header Value: Bearer <your GROQ_API_KEY>

  ${BOLD}Step 3: Create Shopify OAuth2 credential${NC}
    - Go to: Credentials > Add Credential > Shopify OAuth2 API
    - Shop Subdomain: the-fashion-company-3
    - Client ID: <your SHOPIFY_CLIENT_ID>
    - Client Secret: <your SHOPIFY_CLIENT_SECRET>

  ${BOLD}Step 4: Import workflow${NC}
    - Go to: Workflows > Import from File
    - Select: ${WORKFLOW_JSON}

  ${BOLD}Step 5: Activate workflow${NC}
    - Open the imported workflow
    - Toggle it to Active (top-right switch)
    - Click "Chat" to test the chat widget

INSTRUCTIONS
}

# ────────────────────────────────────────────────────────────
# 10. Run tests
# ────────────────────────────────────────────────────────────
run_tests() {
    header "Running test suites"

    # Source env if not already sourced
    if [[ -z "${GROQ_API_KEY:-}" ]] && [[ -f "$ENV_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$ENV_FILE"
    fi

    local pass=0
    local fail_count=0
    local skip=0

    # Test 1: E2E component tests (uses Groq)
    echo ""
    info "Test 1/5: E2E Component Tests (test-e2e.js)"
    if [[ -f "${SCRIPT_DIR}/test-e2e.js" ]]; then
        if NODE_PATH=/tmp/node_modules node "${SCRIPT_DIR}/test-e2e.js"; then
            ok "test-e2e.js passed"
            pass=$((pass + 1))
        else
            fail "test-e2e.js failed"
            fail_count=$((fail_count + 1))
        fi
    else
        warn "test-e2e.js not found — skipped"
        skip=$((skip + 1))
    fi

    # Rate-limit pause between Groq-calling tests
    info "Pausing 10s for Groq rate limit..."
    sleep 10

    # Test 2: Shopify API query tests (uses Groq)
    echo ""
    info "Test 2/5: Shopify API Query Tests (test-shopify-api.js)"
    if [[ -f "${SCRIPT_DIR}/test-shopify-api.js" ]]; then
        if node "${SCRIPT_DIR}/test-shopify-api.js"; then
            ok "test-shopify-api.js passed"
            pass=$((pass + 1))
        else
            fail "test-shopify-api.js failed"
            fail_count=$((fail_count + 1))
        fi
    else
        warn "test-shopify-api.js not found — skipped"
        skip=$((skip + 1))
    fi

    # Rate-limit pause
    info "Pausing 10s for Groq rate limit..."
    sleep 10

    # Test 3: Shopify stress test (no Groq)
    echo ""
    info "Test 3/5: Shopify Stress Test (test-shopify-stress.js)"
    if [[ -f "${SCRIPT_DIR}/test-shopify-stress.js" ]]; then
        if node "${SCRIPT_DIR}/test-shopify-stress.js"; then
            ok "test-shopify-stress.js passed"
            pass=$((pass + 1))
        else
            fail "test-shopify-stress.js failed"
            fail_count=$((fail_count + 1))
        fi
    else
        warn "test-shopify-stress.js not found — skipped"
        skip=$((skip + 1))
    fi

    # Rate-limit pause
    info "Pausing 10s for Groq rate limit..."
    sleep 10

    # Test 4: Cart latency tests (uses Groq)
    echo ""
    info "Test 4/5: Cart Latency Tests (test-cart-latency.js)"
    if [[ -f "${SCRIPT_DIR}/test-cart-latency.js" ]]; then
        if node "${SCRIPT_DIR}/test-cart-latency.js"; then
            ok "test-cart-latency.js passed"
            pass=$((pass + 1))
        else
            fail "test-cart-latency.js failed"
            fail_count=$((fail_count + 1))
        fi
    else
        warn "test-cart-latency.js not found — skipped"
        skip=$((skip + 1))
    fi

    # Test 5: Python E2E test
    echo ""
    info "Test 5/5: Python E2E Tests (test-e2e.py)"
    if [[ -f "${SCRIPT_DIR}/test-e2e.py" ]]; then
        if command_exists python3; then
            if python3 "${SCRIPT_DIR}/test-e2e.py"; then
                ok "test-e2e.py passed"
                pass=$((pass + 1))
            else
                fail "test-e2e.py failed"
                fail_count=$((fail_count + 1))
            fi
        else
            warn "python3 not found — test-e2e.py skipped"
            skip=$((skip + 1))
        fi
    else
        warn "test-e2e.py not found — skipped"
        skip=$((skip + 1))
    fi

    # Test summary
    echo ""
    header "Test Results"
    echo -e "  ${GREEN}Passed:${NC}  ${pass}"
    echo -e "  ${RED}Failed:${NC}  ${fail_count}"
    echo -e "  ${YELLOW}Skipped:${NC} ${skip}"
    echo ""

    if (( fail_count > 0 )); then
        warn "Some tests failed. Check output above for details."
        return 1
    fi
    return 0
}

# ────────────────────────────────────────────────────────────
# 11. Print summary
# ────────────────────────────────────────────────────────────
print_summary() {
    header "Bootstrap Complete"

    cat <<SUMMARY

  Remaining manual steps:

  [ ] Open n8n UI at ${N8N_URL}
  [ ] Create local n8n account (first-time setup)
  [ ] Create Groq Header Auth credential in n8n
  [ ] Create Shopify OAuth2 credential in n8n
  [ ] Import workflow from: shopify-product-chat-workflow-2.json
  [ ] Activate the workflow
  [ ] Test the chat widget

SUMMARY

    if $SKIP_TESTS; then
        info "Tests were skipped. Run: ./bootstrap.sh --tests-only"
    fi

    ok "Done. Happy chatting!"
}

# ════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════
main() {
    echo ""
    echo -e "${BOLD}Shopify n8n Chat Workflow — Bootstrap${NC}"
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if $TESTS_ONLY; then
        setup_env_file
        run_tests
        exit $?
    fi

    check_prerequisites

    if ! $SKIP_N8N; then
        install_n8n
    else
        info "Skipping n8n install (--skip-n8n)"
    fi

    install_claude_code
    install_test_deps
    setup_env_file

    if ! $SKIP_N8N; then
        start_n8n
        apply_sortby_patch
        print_n8n_instructions
    else
        info "Skipping n8n startup and patch (--skip-n8n)"
    fi

    if ! $SKIP_TESTS; then
        if confirm "Run test suites now?"; then
            run_tests || true
        else
            info "Tests skipped."
        fi
    else
        info "Skipping tests (--skip-tests)"
    fi

    print_summary
}

main
