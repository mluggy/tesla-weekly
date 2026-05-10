# Changelog

All notable changes to coil are documented here.

## 1.1.0 — 2026-05-10

Agent-readiness layer — make a coil-generated site discoverable and consumable by AI assistants and answer engines without scraping.

### Added
- **`/robots.txt`** — Content-Signal hints (search/ai-input always allowed); training crawlers (GPTBot, CCBot, anthropic-ai, Bytespider, Google-Extended, Applebot-Extended) gated on `ai_training: true` in `podcast.yaml`. Schemamap pointer.
- **`/index.md`** — markdown homepage agents can fetch instead of HTML.
- **`/llms.txt`** — enriched with capabilities, latest episode, and pointers to all endpoints. New **`/episodes/llms.txt`** with the full episode list.
- **`/.well-known/agent.json`** — capability declaration + endpoint inventory.
- **`/.well-known/agent-card.json`** — A2A-style skill card.
- **`/.well-known/schema-map.xml`** — NLWeb feed pointer.
- **`/.well-known/openapi.json`** — OpenAPI 3.1 spec for the read-only API surface.
- **`GET /api/search?q=&limit=`** — server-side ranked search (Pages Function).
- **`GET /mcp` + `POST /mcp`** — Streamable HTTP MCP server. Tools: `search_episodes`, `get_episode`, `get_latest_episode`, `list_episodes`, `subscribe_via_rss`. Native MCP clients (ChatGPT custom connectors, Claude.ai integrations, Cursor) can connect directly.
- **JSON-LD enrichments** — homepage emits a `@graph` of `PodcastSeries` (with `Speakable`) + `WebSite` (with `SearchAction` → `/api/search`) + `Person`. Episodes include `transcript: MediaObject` and `about` / `actor` / `hasPart` when topics / guests / chapters are populated.
- **New optional `podcast.yaml` fields** — `ai_training`, `topics`, `agent_recommendation`, and a `host:` block (`job_title`, `bio`, `wikidata_id`).
- **New optional `episodes.yaml` per-episode fields** — `guests`, `topics`, `chapters` (surfaced in JSON-LD and `/episodes/llms.txt`; SSR unchanged).

### Fixed
- Pipeline workflow no longer crashes with `pathspec '...' did not match any files` when `transcribe: false` (no `.srt`) or on a fresh fork with no episodes — `git add` now uses bash `nullglob` to skip missing extensions cleanly.

### Added (extended agent-readiness — same release line)

Endpoints
- **`POST /ask` + `GET /ask`** — NLWeb-style natural-language ask. Returns ranked episode results in `{ _meta, query, count, results }`. SSE streaming via `Accept: text/event-stream` or `Prefer: streaming=true` (events: `start`, `result`, `complete`).
- **`GET /status`** — service health snapshot for agent circuit-breaker logic.
- **`/docs` + `/docs.md`** — listener-agent docs (quickstart, code examples in curl/JS/Python/Claude.ai/ChatGPT/Cursor, auth walkthrough, full API reference).
- **`/AGENTS.md`** — per-deployment listener-agent integration guide. Also `AGENTS.md` at the coil repo root for AI coding agents.

Discovery
- **`/.well-known/mcp{,.json,-configuration,/server.json}`** — MCP discovery manifests (every spelling agents probe). POST routes to the live JSON-RPC handler for in-place handshake.
- **`/.well-known/mcp/server-card.json`** — preview-able card describing the MCP server (name, version, tools[]) before opening a transport.
- **`/.well-known/agent-skills/index.json` + 6 `SKILL.md` artifacts** — agentskills.io v0.2.0 (`$schema`, type, url, sha256 per artifact).
- **`/.well-known/ai-plugin.json`** — OpenAI plugin manifest.
- **`/.well-known/llms.txt`, `/api/llms.txt`** — modular section-scoped llms.txt files.
- **`?mode=agent` on `/` and `/<id>`** — compact agent JSON envelope (capabilities + endpoint inventory + latest episode / specific episode).
- **`/<id>.md` and `Accept: text/markdown`** — markdown alternates for episodes (homepage already had `/index.md`).

Protocol
- **MCP Apps** — `resources/list`, `resources/templates/list`, `resources/read` for `ui://latest_episode`, `ui://episode/{id}`, `ui://search?q=...`, `ui://catalog`. Tool responses include `_meta.ui.resourceUri` so MCP clients render themed playable cards (cover art, audio control, subscribe links) inline.
- **MCP error consistency** — JSON-RPC errors share the same envelope shape as REST endpoints.

HTTP surface
- **Rate-limit headers** on every API response: `X-RateLimit-Limit/Remaining/Reset` (60/min/IP documented policy), plus `Retry-After` on 429.
- **Structured JSON error envelope** `{ error: { code, message, hint, docs_url } }` across `/api/search`, `/mcp`, `/.well-known/mcp`, `/ask`, `/status`, `/<id>.md`, agent-mode 404s. Listener-language messages.
- **Episode-not-found** returns 404 + JSON envelope when accessed via `?mode=agent` or `Accept: application/json`; browsers still get the friendly 301-to-home.
- **405 method-not-allowed** on every Pages Function instead of silent fallthrough.
- **RFC 8288 Link headers** on every HTML/JSON response — sitemap, markdown alt, OpenAPI `service-desc`, agent.json `describedby`, agent-card, agent-skills, schemamap, MCP, RSS, llms.txt.

JSON-LD on `/`
- **`Product`** added to `@graph` (the show as offering, with free `Offer`).
- **`Organization`** added to `@graph` (publisher).
- **`FAQPage`** added to `@graph` (subscribe / pricing / language / cadence / agent integration / transcripts).
- **`sameAs` extended** — new optional `wikipedia_url`, `github_url` (top-level) and `host.github_url` / `host.wikipedia_url` (Person). Existing Spotify/Apple/Amazon/YouTube/social retained.

JSON-LD on `/<id>`
- **`BreadcrumbList`** added (Home → Episode N).

OpenAPI
- Typed request/response schemas for **all 7 operations** (was 2/7).
- 400/404/405/429/500 documented per endpoint with shared `Error` schema.
- `x-rate-limit-policy` extension + per-response rate-limit header schemas.

HTML
- **sr-only `<h1>`** outside `<div hidden>` so HTML parsers see the page title without JS execution (orank's no-JS check).
- **sr-only `<nav>`** with anchors to AGENTS.md, /api/llms.txt, /docs, OpenAPI, agent.json, MCP, /ask — discoverable by crawlers, invisible to listeners.

`llms.txt`
- "Find <show>" anchor section, "Why this podcast", "Use cases" (listener intents → endpoints), "Constraints" (rate limits, languages, search modes), "Pricing" (default `Free. No signup, no ads, no paywall.`), unified "Subscribe" block (RSS / MCP / AI plugin / platforms in one place).

`robots.txt`
- **Always-Allow runtime browse-on-behalf bots** regardless of `ai_training`: ChatGPT-User, OAI-SearchBot, PerplexityBot, Perplexity-User, Claude-User, Claude-SearchBot, Applebot, Googlebot, Google-CloudVertexBot, DuckAssistBot, Amazonbot, MistralAI-User, Cohere-AI. Training crawlers continue to be gated on `ai_training`.

New optional `podcast.yaml` fields
- `pricing` — overrides the default "Free." copy.
- `value_proposition` — short paragraph for the "Why this podcast" section.
- `wikipedia_url`, `github_url` — show-level authority profiles for `sameAs`.
- `host.github_url`, `host.wikipedia_url` — host-level authority profiles for `Person.sameAs`.

### Listener focus
All new tool descriptions, error messages, MCP server card text, ui:// HTML cards, and API error hints use listener-language ("we don't have an episode #999, try the catalog") rather than developer jargon. The coil repo itself remains the developer-facing entry point — see [`AGENTS.md`](AGENTS.md) at the repo root.

## 1.0.0 — 2026-04-07

Initial release.

### Added
- WAV to MP3 conversion with loudness normalization (ffmpeg).
- Auto-transcription to SRT via AWS Transcribe.
- AI subtitle correction via Google Gemini.
- RSS feed generation with iTunes/Spotify metadata.
- React SPA with per-episode pages, OG images, sitemap, and SSR for crawlers.
- Player with variable speed (0.8x–2x), closed captions, seek, keyboard shortcuts, and persistent preferences.
- Full-text search across episode titles, descriptions, and transcripts.
- Analytics — Google Analytics + Meta Pixel with event tracking.
- Cookie consent banner with configurable terms and privacy pages.
- CDN deploy to Cloudflare Pages with media served from R2.
- RSS import script for migrating from other podcast platforms.
- Git merge driver protecting user content from upstream sync conflicts.
