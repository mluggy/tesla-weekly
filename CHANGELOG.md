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
