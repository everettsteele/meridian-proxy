# Debug: sorted-api — curl the live endpoint and read the actual error response

**Date:** 2026-03-22
**Source:** Notion page 32c4cf98-04bf-8185-9c3c-cd26238cb33e

## Task
The SORTED app was showing `Error: The string did not match the expected pattern` after several fix attempts. Goal was to test the API directly to see exactly what it's returning.

## Findings

### Step 2 — curl result
```bash
curl -s -X POST https://sorted-api-production.up.railway.app/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Find me 3 bars in Roswell GA within 20 minutes drive. Vibe: chill"}],"max_tokens":1000}'
```

**Result:** 200 OK — valid JSON response from Anthropic API. Response included proper `model`, `id`, `type`, `role`, `content`, `stop_reason`, and `usage` fields. No errors.

### Step 3 — Railway logs
Railway CLI not installed locally. Could not retrieve logs.

### Step 4 — index.js review
Server code is correct:
- Proxies to Anthropic API at `/api/chat`
- Uses model `claude-sonnet-4-6`
- Returns `upstream.status` and `upstream.json()` directly
- CORS headers set properly
- Rate limiting in place (20/hr per IP)

### Diagnosis
The API server is **working correctly**. The error `The string did not match the expected pattern` is a **client-side** error (WebKit/Safari TypeError), not a server-side error. The bug is in the SORTED client app, not sorted-api.

No server-side changes were needed.
