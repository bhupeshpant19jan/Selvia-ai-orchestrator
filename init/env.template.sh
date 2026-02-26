#!/bin/bash
# ============================================================
# Environment Variables Template
# ============================================================
# Copy this file to env.sh and fill in your values:
#   cp env.template.sh env.sh
#
# Then source it before running init.sh:
#   source env.sh && ./init.sh
#
# DO NOT commit env.sh to version control (it's in .gitignore)
# ============================================================

# Groq LLM API key (required)
# Get yours at: https://console.groq.com
export GROQ_API_KEY="REPLACE_ME"

# Shopify store configuration
export SHOPIFY_STORE="your-store.myshopify.com"
export SHOPIFY_STOREFRONT_TOKEN="REPLACE_ME"
export SHOPIFY_ACCESS_TOKEN="REPLACE_ME"  # Admin API token (for stress tests)
export SHOPIFY_API_VERSION="2024-01"

# Shopify OAuth2 credentials (for n8n credential setup)
export SHOPIFY_CLIENT_ID="REPLACE_ME"
export SHOPIFY_CLIENT_SECRET="REPLACE_ME"

# n8n configuration
export N8N_BASE="http://localhost:5678"
export N8N_PORT=5678
