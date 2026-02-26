# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Selvia AI Orchestrator is an n8n-based workflow system that powers a Shopify shopping assistant. It uses Groq LLM (llama-3.3-70b-versatile) for intent extraction and connects to Shopify's Storefront GraphQL API for product search, cart management, and checkout.

**Architecture flow:**
```
Chat Widget (JS) → n8n Webhook → Groq LLM → Shopify Storefront API → Response
```

## Development Commands

### Quick Start (Recommended)
```bash
cd init
cp env.template.sh env.sh   # First time: copy and edit with your API keys
./init.sh                   # Sets up env, starts n8n, imports workflows
./init.sh -y                # Auto-confirm prompts
```

### Init Script Options
```bash
./init/init.sh              # Full setup
./init/init.sh --skip-n8n   # Skip n8n startup
./init/init.sh --skip-workflows  # Skip workflow import
```

### Alternative: Full Bootstrap (includes tests)
```bash
cd src/Misc/LearningSearch
./bootstrap.sh              # Full setup + runs all test suites
./bootstrap.sh --tests-only # Run tests only
```

### n8n Commands
```bash
curl http://localhost:5678/healthz   # Health check
kill $(cat init/n8n.pid)             # Stop n8n
```

### Running Tests
```bash
cd src/Misc/LearningSearch
node test-e2e.js           # Component tests (34 tests)
node test-shopify-api.js   # API integration tests (46 tests)
node test-shopify-stress.js  # Performance tests (50 sequential API calls)
node test-cart-latency.js    # Cart operation latency tests
```

## Architecture

### Directory Structure
- `src/shopify_chat_agent/` - Production Shopify chat agent
- `src/local_chat_agent/` - Local development chat agent
- `src/Misc/LearningSearch/` - R&D environment with setup scripts and tests
- `init/` - Environment setup and n8n startup scripts

### Key Components
- **n8n workflows** (`workflow-webhook.json`) - All orchestration logic lives in JSON workflow files
- **Chat widget** (`chat-widget.js`) - Self-contained JS injected into Shopify themes
- **Groq integration** - Intent extraction (search/cart/checkout routing)
- **Shopify GraphQL** - Product queries, cart operations, checkout URL generation

### No Build System
This codebase has no build step. JSON workflows and JS scripts run as-is. Changes take effect after n8n restart.

## Environment Variables

Required in `init/env.sh` (copy from `init/env.template.sh`):
- `GROQ_API_KEY` - Get from console.groq.com
- `SHOPIFY_STORE` - Store domain
- `SHOPIFY_STOREFRONT_TOKEN` - GraphQL access token
- `SHOPIFY_ACCESS_TOKEN` - Admin API token (for stress tests)
- `N8N_BASE` - n8n endpoint (default: http://localhost:5678)

## Workflow Pattern

The n8n webhook workflow follows this pattern:
1. Chat Webhook - POST `/webhook/shopify-chat` with CORS
2. Groq Parse Intent - Extract intent and product references
3. Switch Router - Route to search or cart flows
4. Shopify Nodes - GraphQL queries
5. Response Formatter - LLM-generated conversational response

Session context is stored in-memory and resets on n8n restart.
