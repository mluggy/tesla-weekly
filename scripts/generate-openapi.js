// Generates /.well-known/openapi.json — describes the listener-facing
// read-only API surface so agents can introspect tools without scraping.
//
// Endpoints described (operationIds map directly to LLM function calls):
//   GET  /api/search       — server-side full-text search
//   POST /ask              — NLWeb-style natural-language ask (JSON or SSE)
//   GET  /ask              — same, query-string variant
//   GET  /status           — service health for circuit-breaker logic
//   GET  /episodes.json    — full episode list (static)
//   GET  /search-index.json — flat search index (static)
//   GET  /rss.xml          — podcast feed
//   GET  /llms.txt         — agent briefing
//   GET  /mcp              — MCP server manifest
//   POST /mcp              — MCP JSON-RPC

import { writeFileSync, mkdirSync } from "fs";
import config from "./load-config.js";

const SITE = "{{SITE_URL}}";

// Reused response refs for the consistent error envelope + rate-limit
// headers. Keeps the typed coverage at 7/7 instead of 2/7.
const errorResponses = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "404": { $ref: "#/components/responses/NotFound" },
  "405": { $ref: "#/components/responses/MethodNotAllowed" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "500": { $ref: "#/components/responses/InternalError" },
};

const spec = {
  openapi: "3.1.0",
  info: {
    title: `${config.title} — Listener API`,
    version: "1.1.0",
    description:
      `Read-only API for consuming ${config.title} episodes. ` +
      `All endpoints are public, unauthenticated, and safe to call from ` +
      `assistant agents on behalf of a listener. ` +
      `For native MCP clients see POST ${SITE}/mcp. ` +
      `For natural-language search see POST ${SITE}/ask (NLWeb-style, JSON or SSE).`,
    ...(config.author ? { contact: { name: config.author } } : {}),
    ...(config.license ? { license: { name: config.license } } : {}),
    "x-rate-limit-policy": {
      limit: 60,
      window: "1 minute",
      scope: "per IP",
      headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
      docs: `${SITE}/api/llms.txt`,
    },
  },
  servers: [{ url: SITE }],
  paths: {
    "/api/search": {
      get: {
        summary: "Search episodes",
        description:
          "Free-text search over episode title, description, and transcript. " +
          "Returns ranked results with snippets.",
        operationId: "searchEpisodes",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1 },
            description: "Search query.",
            example: "agentic commerce",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
            description: "Max results to return.",
          },
        ],
        responses: {
          "200": {
            description: "Ranked search results.",
            headers: rateLimitResponseHeaders(),
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchResponse" },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/ask": {
      post: {
        summary: "Ask the show a question",
        description:
          "NLWeb-style natural-language ask endpoint. Returns episodes ranked by transcript relevance. " +
          "Set `Accept: text/event-stream` (or `Prefer: streaming=true`) for SSE streaming with " +
          "`start`, `result`, `complete` events.",
        operationId: "ask",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AskRequest" },
              example: { query: "ai agents", limit: 5 },
            },
          },
        },
        responses: {
          "200": {
            description: "Either JSON or SSE depending on Accept/Prefer headers.",
            headers: rateLimitResponseHeaders(),
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AskResponse" } },
              "text/event-stream": { schema: { type: "string", description: "NLWeb event stream (start, result*, complete)." } },
            },
          },
          ...errorResponses,
        },
      },
      get: {
        summary: "Ask the show a question (query-string variant)",
        description: "Same as POST /ask but accepts `?q=` for cheap probing.",
        operationId: "askGet",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
        ],
        responses: {
          "200": {
            description: "JSON response (use POST + Accept header for SSE).",
            headers: rateLimitResponseHeaders(),
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AskResponse" } },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/status": {
      get: {
        summary: "Service health",
        description: "Always 200 when reachable. Use for agent circuit-breaker logic.",
        operationId: "getStatus",
        responses: {
          "200": {
            description: "Health snapshot.",
            headers: rateLimitResponseHeaders(),
            content: { "application/json": { schema: { $ref: "#/components/schemas/StatusResponse" } } },
          },
          ...errorResponses,
        },
      },
    },
    "/episodes.json": {
      get: {
        summary: "List all episodes",
        description: "Static JSON: every episode with id, title, date, duration, audio URL, etc.",
        operationId: "listEpisodes",
        responses: {
          "200": {
            description: "Array of episodes (sorted by id ascending).",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Episode" } },
              },
            },
          },
        },
      },
    },
    "/search-index.json": {
      get: {
        summary: "Full search index",
        description:
          "Flat object mapping episode id → indexed text (title + description + transcript). " +
          "Use /api/search for ranked queries; this is for offline indexing.",
        operationId: "getSearchIndex",
        responses: {
          "200": {
            description: "Episode-id → indexed text.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    "/rss.xml": {
      get: {
        summary: "Podcast RSS feed",
        description: "Subscribe via any podcast app.",
        operationId: "getRss",
        responses: {
          "200": {
            description: "RSS 2.0 feed.",
            content: { "application/rss+xml": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/llms.txt": {
      get: {
        summary: "Agent briefing",
        description: "Markdown briefing for assistant agents — what the show is, capabilities, latest episode.",
        operationId: "getLlmsTxt",
        responses: {
          "200": {
            description: "Markdown briefing.",
            content: { "text/plain": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/mcp": {
      get: {
        summary: "MCP server manifest",
        description: "Returns the MCP server manifest (tools list, transport, protocol version).",
        operationId: "getMcpManifest",
        responses: {
          "200": {
            description: "Server manifest.",
            headers: rateLimitResponseHeaders(),
            content: { "application/json": { schema: { $ref: "#/components/schemas/McpManifest" } } },
          },
          ...errorResponses,
        },
      },
      post: {
        summary: "MCP JSON-RPC endpoint",
        description:
          "Streamable HTTP transport for the Model Context Protocol. " +
          "Methods: initialize, ping, tools/list, tools/call. " +
          "Tools: search_episodes, get_episode, get_latest_episode, list_episodes, subscribe_via_rss.",
        operationId: "callMcp",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JsonRpcRequest" },
              example: {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: { name: "search_episodes", arguments: { query: "agents", limit: 5 } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "JSON-RPC 2.0 response.",
            headers: rateLimitResponseHeaders(),
            content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcResponse" } } },
          },
          ...errorResponses,
        },
      },
    },
    "/.well-known/mcp": {
      get: {
        summary: "MCP discovery manifest",
        description:
          "Same as GET /mcp but at the well-known URL. Also accepts POST for live JSON-RPC handshake.",
        operationId: "getMcpWellKnown",
        responses: {
          "200": {
            description: "Discovery manifest.",
            headers: rateLimitResponseHeaders(),
            content: { "application/json": { schema: { $ref: "#/components/schemas/McpManifest" } } },
          },
        },
      },
      post: {
        summary: "MCP JSON-RPC at well-known URL",
        description: "Same JSON-RPC endpoint as /mcp; agents that probe well-known can initialize directly.",
        operationId: "callMcpWellKnown",
        requestBody: { $ref: "#/components/requestBodies/JsonRpcBody" },
        responses: {
          "200": {
            description: "JSON-RPC 2.0 response.",
            headers: rateLimitResponseHeaders(),
            content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcResponse" } } },
          },
          ...errorResponses,
        },
      },
    },
    "/.well-known/mcp/server-card.json": {
      get: {
        summary: "MCP server card",
        description: "Preview-able card describing this MCP server (name, version, tools[]) before opening a transport.",
        operationId: "getMcpServerCard",
        responses: {
          "200": {
            description: "Server card.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/McpServerCard" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Episode: {
        type: "object",
        required: ["id", "season", "title"],
        properties: {
          id: { type: "integer", description: "Episode number." },
          season: { type: "integer" },
          title: { type: "string" },
          desc: { type: "string", description: "Episode description." },
          duration: { type: "string", description: "MM:SS or HH:MM:SS." },
          seconds: { type: "integer" },
          date: { type: "string", format: "date" },
          audioFile: { type: "string", description: "Filename of the MP3." },
          srtFile: { type: "string", description: "Filename of the SRT transcript." },
          guid: { type: "string" },
          spotifyUrl: { type: "string", format: "uri" },
          appleUrl: { type: "string", format: "uri" },
          amazonUrl: { type: "string", format: "uri" },
          youtubeUrl: { type: "string", format: "uri" },
          hasSrt: { type: "boolean" },
          guests: { type: "array", items: { type: "string" } },
          topics: { type: "array", items: { type: "string" } },
          chapters: {
            type: "array",
            items: {
              type: "object",
              properties: { start: { type: "string" }, title: { type: "string" } },
            },
          },
        },
      },
      SearchResult: {
        type: "object",
        required: ["id", "title", "url", "score"],
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          date: { type: "string" },
          season: { type: "integer" },
          duration: { type: "string" },
          url: { type: "string", format: "uri" },
          audio: { type: "string", format: "uri" },
          transcript: { type: ["string", "null"], format: "uri" },
          score: { type: "number" },
          snippet: { type: "string" },
        },
      },
      SearchResponse: {
        type: "object",
        required: ["query", "count", "results"],
        properties: {
          query: { type: "string" },
          count: { type: "integer" },
          took_ms: { type: "integer" },
          results: { type: "array", items: { $ref: "#/components/schemas/SearchResult" } },
        },
      },
      AskRequest: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, description: "Natural-language question." },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
      },
      AskResponse: {
        type: "object",
        required: ["_meta", "query", "count", "results"],
        properties: {
          _meta: {
            type: "object",
            required: ["response_type", "version"],
            properties: {
              response_type: { type: "string", enum: ["list"] },
              version: { type: "string" },
              site: { type: "string" },
              contentType: { type: "string" },
              query: { type: "string" },
              generated_at: { type: "string", format: "date-time" },
            },
          },
          query: { type: "string" },
          count: { type: "integer" },
          took_ms: { type: "integer" },
          results: { type: "array", items: { $ref: "#/components/schemas/SearchResult" } },
        },
      },
      StatusResponse: {
        type: "object",
        required: ["status", "name"],
        properties: {
          status: { type: "string", enum: ["ok"] },
          name: { type: "string" },
          description: { type: "string" },
          version: { type: "string" },
          contentType: { type: "string" },
          language: { type: "string" },
          episodeCount: { type: "integer" },
          latestEpisode: {
            type: ["object", "null"],
            properties: {
              id: { type: "integer" },
              title: { type: "string" },
              datePublished: { type: "string" },
            },
          },
          generated_at: { type: "string", format: "date-time" },
        },
      },
      McpManifest: {
        type: "object",
        required: ["server", "protocolVersion", "transport", "endpoint"],
        properties: {
          server: {
            type: "object",
            properties: { name: { type: "string" }, version: { type: "string" } },
          },
          protocolVersion: { type: "string" },
          transport: { type: "string" },
          endpoint: { type: "string", format: "uri" },
          methods: { type: "array", items: { type: "string" } },
          tools: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          docs: { type: "string", format: "uri" },
        },
      },
      McpServerCard: {
        type: "object",
        required: ["name", "version", "serverUrl", "tools"],
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          version: { type: "string" },
          protocolVersion: { type: "string" },
          transport: { type: "string" },
          serverUrl: { type: "string", format: "uri" },
          handshakeUrl: { type: "string", format: "uri" },
          publisher: { type: "string" },
          contentType: { type: "string" },
          language: { type: "string" },
          tools: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "description"],
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                inputSchema: { type: "object" },
              },
            },
          },
        },
      },
      JsonRpcRequest: {
        type: "object",
        required: ["jsonrpc", "method"],
        properties: {
          jsonrpc: { type: "string", enum: ["2.0"] },
          id: { oneOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] },
          method: { type: "string" },
          params: { type: "object" },
        },
      },
      JsonRpcResponse: {
        type: "object",
        required: ["jsonrpc"],
        properties: {
          jsonrpc: { type: "string", enum: ["2.0"] },
          id: { oneOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] },
          result: {},
          error: {
            type: "object",
            properties: {
              code: { type: "integer" },
              message: { type: "string" },
              data: {},
            },
          },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", description: "Machine-readable error code." },
              message: { type: "string", description: "Human-readable explanation in listener-friendly English." },
              hint: { type: "string", description: "Actionable next step (URL or example)." },
              docs_url: { type: "string", format: "uri" },
            },
          },
        },
      },
    },
    requestBodies: {
      JsonRpcBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/JsonRpcRequest" },
            example: { jsonrpc: "2.0", id: 1, method: "initialize" },
          },
        },
      },
    },
    responses: {
      BadRequest: {
        description: "The request was malformed (missing/invalid parameter, bad body).",
        headers: rateLimitResponseHeaders(),
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "The requested resource doesn't exist on this show.",
        headers: rateLimitResponseHeaders(),
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      MethodNotAllowed: {
        description: "The HTTP method isn't supported on this endpoint.",
        headers: rateLimitResponseHeaders(),
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      RateLimited: {
        description: "Rate limit exceeded. Inspect Retry-After / X-RateLimit-* headers.",
        headers: {
          ...rateLimitResponseHeaders(),
          "Retry-After": { schema: { type: "integer" }, description: "Seconds to wait before retrying." },
        },
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      InternalError: {
        description: "Something broke on our side.",
        headers: rateLimitResponseHeaders(),
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
};

function rateLimitResponseHeaders() {
  return {
    "X-RateLimit-Limit": { schema: { type: "integer" }, description: "Requests allowed per window." },
    "X-RateLimit-Remaining": { schema: { type: "integer" }, description: "Requests remaining in window." },
    "X-RateLimit-Reset": { schema: { type: "integer" }, description: "Unix timestamp when window resets." },
  };
}

mkdirSync("public/.well-known", { recursive: true });
writeFileSync("public/.well-known/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log("Generated public/.well-known/openapi.json");
