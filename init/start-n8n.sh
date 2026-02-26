#!/bin/bash

# n8n Startup Script with Workflow Import
# Starts n8n if not running and imports ShopifyAgent workflows

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N8N_PORT=5678
N8N_URL="http://localhost:${N8N_PORT}"

# Workflow files to import
WORKFLOWS=(
    "${SCRIPT_DIR}/shopify-agent-workflow.json"
    "${SCRIPT_DIR}/shopify-simple-cart.json"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if n8n is already running
check_n8n_running() {
    if curl -s "${N8N_URL}/healthz" > /dev/null 2>&1; then
        return 0
    fi

    # Also check if port is in use
    if command -v lsof &> /dev/null; then
        if lsof -i :${N8N_PORT} > /dev/null 2>&1; then
            return 0
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tlnp 2>/dev/null | grep -q ":${N8N_PORT}"; then
            return 0
        fi
    fi

    return 1
}

# Wait for n8n to be ready
wait_for_n8n() {
    local max_attempts=30
    local attempt=1

    log_info "Waiting for n8n to be ready..."

    while [ $attempt -le $max_attempts ]; do
        if curl -s "${N8N_URL}/healthz" > /dev/null 2>&1; then
            log_info "n8n is ready!"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo ""
    log_error "n8n failed to start within expected time"
    return 1
}

# Import workflows using n8n CLI
import_workflows() {
    log_info "Importing workflows..."

    for workflow in "${WORKFLOWS[@]}"; do
        if [ -f "$workflow" ]; then
            local name=$(basename "$workflow")
            log_info "Importing: $name"

            # Use n8n CLI to import workflow
            if npx n8n import:workflow --input="$workflow" 2>/dev/null; then
                log_info "Successfully imported: $name"
            else
                log_warn "Could not import $name (may already exist or require manual import)"
            fi
        else
            log_warn "Workflow file not found: $workflow"
        fi
    done
}

# Main execution
main() {
    echo "=========================================="
    echo "  n8n Startup Script - ShopifyAgent"
    echo "=========================================="
    echo ""

    # Check if n8n is already running
    if check_n8n_running; then
        log_info "n8n is already running at ${N8N_URL}"
        echo ""
        echo "To import workflows manually:"
        echo "  1. Open ${N8N_URL}"
        echo "  2. Go to Workflows > Import from File"
        echo "  3. Import the JSON files from ${SCRIPT_DIR}"
        echo ""
        exit 0
    fi

    log_info "n8n is not running. Starting..."

    # Check if npx/n8n is available
    if ! command -v npx &> /dev/null; then
        log_error "npx not found. Please install Node.js first."
        exit 1
    fi

    # Start n8n in background
    log_info "Starting n8n on port ${N8N_PORT}..."

    # Use default n8n data directory (~/.n8n) to preserve existing credentials and workflows

    # Start n8n in background
    nohup npx n8n start > "${SCRIPT_DIR}/n8n.log" 2>&1 &
    N8N_PID=$!

    echo $N8N_PID > "${SCRIPT_DIR}/n8n.pid"
    log_info "n8n started with PID: $N8N_PID"

    # Wait for n8n to be ready
    if ! wait_for_n8n; then
        log_error "Failed to start n8n. Check ${SCRIPT_DIR}/n8n.log for details."
        exit 1
    fi

    # Import workflows
    import_workflows

    echo ""
    echo "=========================================="
    log_info "n8n is running!"
    echo ""
    echo "  Web UI: ${N8N_URL}"
    echo "  Log:    ${SCRIPT_DIR}/n8n.log"
    echo "  PID:    $N8N_PID"
    echo ""
    echo "To stop n8n later:"
    echo "  kill \$(cat ${SCRIPT_DIR}/n8n.pid)"
    echo "=========================================="
}

main "$@"
