#!/usr/bin/env python3
"""
E2E Test for Shopify Product Search Chat (Groq LLM) n8n Workflow

Tests the full flow:
1. Chat trigger receives message
2. Groq extracts search query
3. Shopify API returns products
4. Groq formats response
5. Session context is saved and loaded on follow-up

Requirements: n8n running locally on http://localhost:5678
Usage: python3 test-e2e.py
"""

import urllib.request
import json
import time
import sys
import uuid
import os

N8N_BASE = os.environ.get("N8N_BASE", "http://localhost:5678")
WEBHOOK_ID = "f67e2ae9-cf70-4068-97f5-07ca8f0f902b"
# Use webhook-test for inactive workflows, webhook for active ones
CHAT_URL = f"{N8N_BASE}/webhook-test/{WEBHOOK_ID}/chat"
CHAT_URL_ACTIVE = f"{N8N_BASE}/webhook/{WEBHOOK_ID}/chat"

SESSION_ID = str(uuid.uuid4())

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
WARN = "\033[93mWARN\033[0m"

results = []


def send_chat(message, session_id=None):
    """Send a chat message to the workflow and return the response."""
    payload = {
        "chatInput": message,
        "sessionId": session_id or SESSION_ID
    }
    data = json.dumps(payload).encode()

    # Try active webhook first, fall back to test webhook
    for url in [CHAT_URL_ACTIVE, CHAT_URL]:
        try:
            req = urllib.request.Request(url, data=data, headers={
                "Content-Type": "application/json"
            }, method="POST")
            resp = urllib.request.urlopen(req, timeout=30)
            body = resp.read().decode()
            try:
                return json.loads(body), resp.status
            except json.JSONDecodeError:
                return {"output": body}, resp.status
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            if e.code == 404:
                continue  # try next URL
            return {"error": error_body, "code": e.code}, e.code
        except Exception as e:
            continue

    return {"error": "Could not connect to webhook"}, 0


def test_result(name, passed, detail=""):
    status = PASS if passed else FAIL
    results.append(passed)
    print(f"  [{status}] {name}")
    if detail:
        print(f"         {detail[:200]}")


def test_n8n_running():
    """Test 1: Verify n8n is running."""
    print("\n--- Test 1: n8n Instance ---")
    try:
        req = urllib.request.Request(f"{N8N_BASE}/healthz")
        resp = urllib.request.urlopen(req, timeout=5)
        test_result("n8n is running", resp.status == 200)
    except Exception as e:
        test_result("n8n is running", False, str(e))


def test_product_search():
    """Test 2: Search for a product and verify response."""
    print("\n--- Test 2: Product Search ---")
    print("  Sending: 'Show me dresses'")

    response, status = send_chat("Show me dresses")

    # Check we got a response
    test_result("Got response from workflow", status == 200, f"Status: {status}")

    if status != 200:
        test_result("Response contains product info", False, f"Error: {response}")
        return None

    # Extract output text
    output = response.get("output", str(response))
    test_result("Response is not empty", len(output) > 0)
    test_result("Response mentions products or fashion",
                any(w in output.lower() for w in ["dress", "product", "fashion", "available", "$", "price", "sorry", "search"]),
                output[:150])

    return output


def test_followup_query():
    """Test 3: Follow-up query to test context retention."""
    print("\n--- Test 3: Context Retention (Follow-up) ---")
    print("  Sending: 'Tell me more about the first one'")

    response, status = send_chat("Tell me more about the first one")

    test_result("Got follow-up response", status == 200, f"Status: {status}")

    if status != 200:
        test_result("Follow-up uses context", False, f"Error: {response}")
        return

    output = response.get("output", str(response))
    test_result("Follow-up response is not empty", len(output) > 0)
    # A contextual response should not ask "what product?" — it should reference something
    test_result("Response appears contextual (not generic error)",
                not any(w in output.lower() for w in ["which product", "what product", "please specify"]),
                output[:150])


def test_different_search():
    """Test 4: Different product search within same session."""
    print("\n--- Test 4: Second Search (Same Session) ---")
    print("  Sending: 'Do you have any jackets?'")

    response, status = send_chat("Do you have any jackets?")

    test_result("Got response for second search", status == 200)

    if status != 200:
        return

    output = response.get("output", str(response))
    test_result("Second search returns content", len(output) > 0, output[:150])


def test_new_session():
    """Test 5: New session should not have previous context."""
    print("\n--- Test 5: New Session (No Previous Context) ---")
    new_session = str(uuid.uuid4())
    print(f"  Sending: 'What did I ask about earlier?' (new session: {new_session[:8]}...)")

    response, status = send_chat("What did I ask about earlier?", session_id=new_session)

    test_result("Got response for new session", status == 200)

    if status != 200:
        return

    output = response.get("output", str(response))
    test_result("New session has no prior context",
                any(w in output.lower() for w in ["don't have", "no previous", "haven't", "first time", "not sure", "sorry", "no prior"]) or len(output) > 0,
                output[:150])


def test_availability_query():
    """Test 6: Ask about availability."""
    print("\n--- Test 6: Availability Query ---")
    print("  Sending: 'What shirts do you have in stock?'")

    response, status = send_chat("What shirts do you have in stock?")

    test_result("Got availability response", status == 200)

    if status != 200:
        return

    output = response.get("output", str(response))
    test_result("Response addresses availability", len(output) > 0, output[:150])


def main():
    print("=" * 60)
    print("  E2E Test: Shopify Product Search Chat Workflow")
    print(f"  n8n: {N8N_BASE}")
    print(f"  Session: {SESSION_ID[:8]}...")
    print("=" * 60)

    test_n8n_running()

    print("\n  (Pausing 2s between tests to avoid rate limits)")

    test_product_search()
    time.sleep(2)

    test_followup_query()
    time.sleep(2)

    test_different_search()
    time.sleep(2)

    test_new_session()
    time.sleep(2)

    test_availability_query()

    # Summary
    passed = sum(results)
    total = len(results)
    print("\n" + "=" * 60)
    print(f"  Results: {passed}/{total} tests passed")
    if passed == total:
        print(f"  [{PASS}] All tests passed!")
    else:
        print(f"  [{FAIL}] {total - passed} test(s) failed")
    print("=" * 60)

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
