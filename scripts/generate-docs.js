// Generates /docs.md — listener-agent integration docs.
// Listener-focused: quickstart, code examples, auth walkthrough, API
// reference. Not a coil developer guide (that lives at /AGENTS.md in the
// upstream repo).
//
// The middleware also serves the same content at GET /docs (with proper
// markdown content-type) — single source of truth.

import { writeFileSync } from "fs";
import config from "./load-config.js";

const SITE = "{{SITE_URL}}";

const doc = [];

doc.push(`# ${config.title} — Docs for AI agents`);
doc.push("");
doc.push(`> Build a listener integration for ${config.title} in five minutes. No signup, no API keys, no rate-limit gymnastics.`);
doc.push("");

doc.push("## Quickstart");
doc.push("");
doc.push("Three lines, in order, get you from zero to a real episode:");
doc.push("");
doc.push("```bash");
doc.push(`# 1. Health check`);
doc.push(`curl ${SITE}/status`);
doc.push("");
doc.push(`# 2. Find an episode about something the listener cares about`);
doc.push(`curl '${SITE}/api/search?q=ai&limit=3'`);
doc.push("");
doc.push(`# 3. Read the full transcript of the top result (replace 1 with the id)`);
doc.push(`curl ${SITE}/1.md`);
doc.push("```");
doc.push("");

doc.push("## Authentication");
doc.push("");
doc.push("**None required.** Every endpoint is public, read-only, and CORS-open. No keys, no tokens, no signup.");
doc.push("");
doc.push("Rate limits are documented (60 req/min per IP) but enforced at the edge — your code only needs to honor `X-RateLimit-Remaining` and `Retry-After` if you see them. There's no auth header to add.");
doc.push("");

doc.push("## Code examples");
doc.push("");
doc.push("### curl");
doc.push("```bash");
doc.push(`# Latest episode as JSON`);
doc.push(`curl '${SITE}/?mode=agent'`);
doc.push("");
doc.push(`# Episode in markdown (use Accept header or .md suffix)`);
doc.push(`curl ${SITE}/1.md`);
doc.push(`curl -H 'Accept: text/markdown' ${SITE}/1`);
doc.push("");
doc.push(`# NLWeb /ask, JSON`);
doc.push(`curl -X POST -H 'Content-Type: application/json' -d '{"query":"agentic commerce"}' ${SITE}/ask`);
doc.push("");
doc.push(`# NLWeb /ask, SSE streaming`);
doc.push(`curl -N -H 'Accept: text/event-stream' '${SITE}/ask?q=agentic+commerce'`);
doc.push("");
doc.push(`# MCP initialize (Streamable HTTP)`);
doc.push(`curl -X POST -H 'Content-Type: application/json' \\`);
doc.push(`  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \\`);
doc.push(`  ${SITE}/mcp`);
doc.push("```");
doc.push("");

doc.push("### JavaScript / TypeScript");
doc.push("```js");
doc.push(`// Search`);
doc.push(`const r = await fetch('${SITE}/api/search?q=ai+agents&limit=5');`);
doc.push(`const { results } = await r.json();`);
doc.push("");
doc.push(`// Latest episode card`);
doc.push(`const agent = await fetch('${SITE}/?mode=agent').then(r => r.json());`);
doc.push(`console.log(agent.latestEpisode);`);
doc.push("");
doc.push(`// MCP tool call`);
doc.push(`const mcp = await fetch('${SITE}/mcp', {`);
doc.push(`  method: 'POST',`);
doc.push(`  headers: { 'Content-Type': 'application/json' },`);
doc.push(`  body: JSON.stringify({`);
doc.push(`    jsonrpc: '2.0', id: 1,`);
doc.push(`    method: 'tools/call',`);
doc.push(`    params: { name: 'search_episodes', arguments: { query: 'ai', limit: 5 } },`);
doc.push(`  }),`);
doc.push(`}).then(r => r.json());`);
doc.push("```");
doc.push("");

doc.push("### Python");
doc.push("```python");
doc.push(`import requests`);
doc.push("");
doc.push(`# Search`);
doc.push(`r = requests.get('${SITE}/api/search', params={'q': 'ai agents', 'limit': 5})`);
doc.push(`results = r.json()['results']`);
doc.push("");
doc.push(`# NLWeb ask`);
doc.push(`r = requests.post('${SITE}/ask', json={'query': 'agentic commerce'})`);
doc.push(`for ep in r.json()['results']:`);
doc.push(`    print(ep['title'], ep['url'])`);
doc.push("```");
doc.push("");

doc.push("### Claude.ai (custom MCP connector)");
doc.push("```");
doc.push(`Settings → Connectors → Add custom connector`);
doc.push(`URL: ${SITE}/mcp`);
doc.push(`Transport: Streamable HTTP`);
doc.push(`Auth: None`);
doc.push("```");
doc.push(`After adding, Claude can call \`search_episodes\`, \`get_episode\`, \`get_latest_episode\`, \`list_episodes\`, and \`subscribe_via_rss\` directly.`);
doc.push("");

doc.push("### ChatGPT (custom GPT)");
doc.push("```");
doc.push(`Configure → Actions → Import from URL`);
doc.push(`URL: ${SITE}/.well-known/openapi.json`);
doc.push(`Auth: None`);
doc.push("```");
doc.push(`Or import the OpenAI plugin manifest at \`${SITE}/.well-known/ai-plugin.json\`.`);
doc.push("");

doc.push("### Cursor (MCP)");
doc.push("```json");
doc.push(`{`);
doc.push(`  "mcpServers": {`);
doc.push(`    "${(config.title || "podcast").toLowerCase().replace(/\s+/g, "-")}": {`);
doc.push(`      "url": "${SITE}/mcp",`);
doc.push(`      "transport": "streamable-http"`);
doc.push(`    }`);
doc.push(`  }`);
doc.push(`}`);
doc.push("```");
doc.push("");

doc.push("## API reference");
doc.push("");
doc.push("| Endpoint | Method | Description |");
doc.push("|---|---|---|");
doc.push(`| \`/api/search?q=&limit=\` | GET | Ranked full-text search over title + description + transcript |`);
doc.push(`| \`/ask\` | POST | NLWeb-style natural-language ask. JSON or SSE (\`Accept: text/event-stream\`) |`);
doc.push(`| \`/ask?q=\` | GET | Same as POST /ask but query-string |`);
doc.push(`| \`/mcp\` | POST | MCP JSON-RPC (Streamable HTTP). Methods: initialize, ping, tools/list, tools/call |`);
doc.push(`| \`/mcp\` | GET | MCP server manifest |`);
doc.push(`| \`/.well-known/mcp\` | GET/POST | MCP discovery + live handshake (same JSON-RPC handler) |`);
doc.push(`| \`/.well-known/mcp/server-card.json\` | GET | Preview-able server card (name, version, tools[]) |`);
doc.push(`| \`/status\` | GET | Service health for circuit-breaker logic |`);
doc.push(`| \`/episodes.json\` | GET | Full episode list with metadata |`);
doc.push(`| \`/search-index.json\` | GET | Flat search index for offline indexing |`);
doc.push(`| \`/<id>\` | GET | Episode HTML page (SSR'd, JS-free) |`);
doc.push(`| \`/<id>.md\` | GET | Episode in markdown (or \`Accept: text/markdown\`) |`);
doc.push(`| \`/<id>?mode=agent\` | GET | Episode as compact agent JSON |`);
doc.push(`| \`/?mode=agent\` | GET | Homepage as agent JSON (capabilities + endpoints + latest episode) |`);
doc.push(`| \`/index.md\` | GET | Homepage as markdown |`);
doc.push(`| \`/AGENTS.md\` | GET | This deployment's AGENTS.md |`);
doc.push(`| \`/llms.txt\`, \`/episodes/llms.txt\`, \`/api/llms.txt\`, \`/.well-known/llms.txt\` | GET | Section-scoped llms.txt files |`);
doc.push(`| \`/.well-known/openapi.json\` | GET | OpenAPI 3.1 spec |`);
doc.push(`| \`/.well-known/agent.json\` | GET | Agent capability declaration (schemaVersion 1.0) |`);
doc.push(`| \`/.well-known/agent-card.json\` | GET | A2A-style skill card |`);
doc.push(`| \`/.well-known/agent-skills/index.json\` | GET | agentskills.io v0.2.0 index |`);
doc.push(`| \`/.well-known/ai-plugin.json\` | GET | OpenAI plugin manifest |`);
doc.push(`| \`/.well-known/schema-map.xml\` | GET | NLWeb pointer to all structured feeds |`);
doc.push(`| \`/rss.xml\` | GET | RSS 2.0 feed |`);
doc.push("");
doc.push(`Full typed schema for every operation is in [\`${SITE}/.well-known/openapi.json\`](${SITE}/.well-known/openapi.json).`);
doc.push("");

doc.push("## Errors");
doc.push("");
doc.push("Every error is a structured JSON envelope:");
doc.push("```json");
doc.push(`{`);
doc.push(`  "error": {`);
doc.push(`    "code": "episode_not_found",`);
doc.push(`    "message": "We don't have an episode #999 on this show.",`);
doc.push(`    "hint": "/episodes.json — full catalog with valid IDs",`);
doc.push(`    "docs_url": "/api/llms.txt"`);
doc.push(`  }`);
doc.push(`}`);
doc.push("```");
doc.push("");
doc.push("| Status | Code examples | When |");
doc.push("|---|---|---|");
doc.push("| 400 | `missing_query`, `bad_limit`, `bad_body` | Bad input |");
doc.push("| 404 | `episode_not_found` | Episode ID doesn't exist |");
doc.push("| 405 | `method_not_allowed` | Wrong HTTP method |");
doc.push("| 429 | `rate_limited` | Over 60 req/min/IP |");
doc.push("| 500 | `internal_error` | Something broke server-side |");
doc.push("");

doc.push("## Rate limits");
doc.push("");
doc.push(`- **60 requests/minute per IP** across every endpoint listed above.`);
doc.push(`- Headers on every API response: \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\` (Unix seconds).`);
doc.push(`- 429 responses also carry \`Retry-After\` (seconds).`);
doc.push(`- Self-throttle on those headers — don't backoff blindly.`);
doc.push("");

doc.push("## More");
doc.push("");
doc.push(`- Listener-agent integration guide: [\`${SITE}/AGENTS.md\`](${SITE}/AGENTS.md)`);
doc.push(`- Show briefing: [\`${SITE}/llms.txt\`](${SITE}/llms.txt)`);
doc.push(`- API briefing: [\`${SITE}/api/llms.txt\`](${SITE}/api/llms.txt)`);
doc.push(`- Coil source (the platform that generated this site): https://github.com/mluggy/coil`);
doc.push("");

writeFileSync("public/docs.md", doc.join("\n"));
console.log("Generated public/docs.md");
