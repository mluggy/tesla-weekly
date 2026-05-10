# AGENTS.md

This repo is **coil** — a self-hosted podcast platform that generates a complete production podcast website (player, search, transcripts, RSS, OG images, CDN deploy) from a single `podcast.yaml` plus episode WAVs.

This file is for AI coding agents working on **coil itself**. If you've landed here looking to consume a coil-generated podcast on behalf of a listener, see the deployment's `/AGENTS.md`, `/llms.txt`, `/.well-known/agent.json`, and `/mcp` endpoints — those are the listener-facing agent surfaces.

## What ships from this repo

- `scripts/` — build pipeline (Node + Python). Runs at `npm run build` via `scripts/build-all.js`. Order matters; new generators go between `yaml-to-json` and `vite build`.
- `functions/` — Cloudflare Pages Functions. `_middleware.js` is the request hot-path: SSR, security headers, R2 streaming, agent-mode JSON, markdown content negotiation, MCP discovery, RFC 8288 Link headers.
- `functions/api/` and `functions/mcp.js` — read-only HTTP + MCP server. All static-data driven; no callable RPC backend.
- `src/` — React 19 SPA. Mounts inside `<div id="root">`. SSR content lives in a sibling `<div hidden>` for crawlers, and an sr-only `<h1>` is emitted alongside for HTML parsers that skip `[hidden]` content.
- `podcast.yaml` — single source of truth for show metadata. Frozen via `merge=ours` for downstream forks (see `.gitattributes`).

## Listener-facing agent surfaces (generated per deployment)

Every coil deployment exposes a complete agent-readiness layer. When editing generators, preserve these surfaces:

| Surface | Generator |
|---|---|
| `/llms.txt`, `/episodes/llms.txt`, `/api/llms.txt`, `/.well-known/llms.txt` | `scripts/generate-llms.js` |
| `/.well-known/agent.json`, `/.well-known/agent-card.json`, `/.well-known/schema-map.xml`, `/index.md`, `/AGENTS.md` | `scripts/generate-agent-files.js` |
| `/.well-known/agent-skills/index.json` + `SKILL.md` artifacts | `scripts/generate-agent-skills.js` |
| `/.well-known/openapi.json` | `scripts/generate-openapi.js` |
| `/robots.txt`, `/sitemap.xml` | `scripts/generate-sitemap.js` |
| `/.well-known/mcp{,*}`, `?mode=agent`, `<id>.md`, `Accept: text/markdown`, `Link:` headers | `functions/_middleware.js` |
| `/mcp` (Streamable HTTP, JSON-RPC) | `functions/mcp.js` |

## Conventions to follow

- **Static-data driven.** No databases, no auth. Every agent endpoint resolves against committed JSON/markdown artifacts. New endpoints should follow the same pattern.
- **`{{SITE_URL}}` placeholders, rewritten per request.** Generated artifacts use the placeholder; `_middleware.js`'s `SITE_URL_REWRITES` set + `rewriteSiteUrl()` substitutes the real host. Add new placeholder-bearing artifacts to that set.
- **Don't break upstream-frozen files.** `podcast.yaml`, `episodes/episodes.yaml`, episode media, `public/cover.png`, and `wrangler.toml` are listed in `.gitattributes` with `merge=ours` so downstream forks keep their content. Don't modify their schemas in breaking ways without a CHANGELOG entry.
- **No new runtime dependencies in `functions/`.** Cloudflare Workers cold-start budget is tight. Helpers that already exist (`esc`, `getBaseUrl`, `linkHeader`, `securityHeaders`) should be reused, not duplicated.
- **Generators must be idempotent.** `scripts/build-all.js` runs them in series; rerunning the build should produce the same artifacts byte-for-byte (modulo timestamps). Sort iterations, don't depend on filesystem order.

## Test plan for changes

```bash
nvm use && npm install && pip install -r requirements.txt
npm run build       # full pipeline: yaml → og → feed → sitemap → llms → agent-files → agent-skills → openapi → vite → html-template
npm run preview     # wrangler pages dev with the real middleware
npm test            # vitest
```

For UI changes, use `npm run preview` (not `npm run dev` — Vite dev doesn't run middleware). Verify SSR by `curl -A Googlebot https://localhost:.../` and grep for `<h1`.

For agent-readiness changes, verify each surface independently:

```bash
curl -s http://localhost:8788/llms.txt | head
curl -s http://localhost:8788/.well-known/agent.json | jq .endpoints
curl -s http://localhost:8788/.well-known/mcp | jq .
curl -sI http://localhost:8788/ | grep -i link
curl -s 'http://localhost:8788/?mode=agent' | jq .
curl -sH 'Accept: text/markdown' http://localhost:8788/ | head
curl -s http://localhost:8788/.well-known/agent-skills/index.json | jq '.skills | length'
```

## What not to add

- Server-side rendering for non-deterministic content (random episode picker, etc.) — breaks edge caching.
- Cookies beyond `theme` and `cookie_consent`. Don't introduce session state.
- New agent endpoints that require backend storage. If it can't be answered from the static artifact set, it doesn't ship.
- Tooling that requires the user to install global CLIs beyond what `package.json`/`requirements.txt` declare.

## Releases

Tag from `main` after `npm run build && npm test` pass. Update `CHANGELOG.md` per the existing format. Downstream forks pull via `git pull upstream main` — only `merge=ours` files are protected, so visible changes to scripts/functions land immediately on the next sync.
