// MCP server (Streamable HTTP transport) — listener-facing.
// Lets ChatGPT custom connectors, Claude.ai integrations, Cursor, and
// other native MCP clients consume the show via JSON-RPC tool calls.
//
// Tools (all read-only, all driven by static episode data):
//   search_episodes(query, limit?)   — ranked match
//   get_episode(id)                  — full detail incl. transcript
//   get_latest_episode()             — most recent
//   list_episodes(limit?, offset?)   — paginated browse
//   subscribe_via_rss()              — return RSS URL

import episodes from "./_episodes.js";
import config from "./_config.js";
import { searchEpisodes, summarizeEpisode } from "./_search.js";
import { apiHeaders, corsPreflight, errors } from "./_api.js";
import { buildUiResource, listUiResources, listUiResourceTemplates, uiResourceForTool } from "./_mcp_apps.js";

export const SERVER_INFO = {
  name: "coil-podcast-mcp",
  version: "1.0.0",
};

export const PROTOCOL_VERSION = "2025-03-26";

export const TOOLS = [
  {
    name: "search_episodes",
    description:
      `Search ${config.title || "podcast"} episodes by topic, person, company, or keyword. ` +
      "Returns ranked results with title, date, URL, and a snippet from the transcript. " +
      "Use when a listener asks 'which episode covers <X>' or 'find the one about <Y>'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (free text)." },
        limit: { type: "integer", description: "Max results (1–50).", default: 10, minimum: 1, maximum: 50 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_episode",
    description:
      "Fetch a single episode by its numeric ID. Returns title, date, description, audio URL, transcript URL, and full transcript text. " +
      "Use when a listener references an episode number, or after a search picked one out.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Episode number (1, 2, …).", minimum: 1 },
      },
      required: ["id"],
    },
  },
  {
    name: "get_latest_episode",
    description:
      "Return the most recently published episode with metadata, audio URL, and transcript URL. " +
      "Use when a listener asks 'what's the new episode' or 'what just dropped'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_episodes",
    description:
      "Return episodes in reverse-chronological order with pagination. " +
      "Use when a listener wants to browse the catalog.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 20, minimum: 1, maximum: 100 },
        offset: { type: "integer", default: 0, minimum: 0 },
      },
    },
  },
  {
    name: "subscribe_via_rss",
    description:
      "Return the canonical RSS feed URL so the listener can subscribe in their podcast app. " +
      "Use when the listener says 'subscribe', 'follow', or asks how to get new episodes.",
    inputSchema: { type: "object", properties: {} },
  },
];

function jrpcOk(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: apiHeaders(),
  });
}

function jrpcErr(id, code, message, data) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data ? { data } : {}) },
    }),
    { status: 200, headers: apiHeaders() }
  );
}

function textContent(obj) {
  return [{ type: "text", text: JSON.stringify(obj, null, 2) }];
}

function callTool(name, args, baseUrl) {
  switch (name) {
    case "search_episodes": {
      const query = String(args.query || "").trim();
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
      if (!query) throw new Error("Tell us what to search for: pass `query`.");
      const results = searchEpisodes(query, { limit, baseUrl });
      return { query, count: results.length, results };
    }
    case "get_episode": {
      const id = Number(args.id);
      if (!Number.isInteger(id)) throw new Error("`id` must be an integer episode number.");
      const ep = episodes.find((e) => e.id === id);
      if (!ep) throw new Error(`No episode #${id} on this show. Try list_episodes() to see what's available.`);
      return {
        ...summarizeEpisode(ep, baseUrl),
        fullText: ep.fullText || null,
      };
    }
    case "get_latest_episode": {
      const sorted = [...episodes].sort((a, b) => b.id - a.id);
      const ep = sorted[0];
      if (!ep) throw new Error("No episodes published yet.");
      return summarizeEpisode(ep, baseUrl);
    }
    case "list_episodes": {
      const sorted = [...episodes].sort((a, b) => b.id - a.id);
      const offset = Math.max(0, Number(args.offset) || 0);
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      return {
        total: sorted.length,
        offset,
        limit,
        episodes: sorted.slice(offset, offset + limit).map((e) => summarizeEpisode(e, baseUrl)),
      };
    }
    case "subscribe_via_rss": {
      return { rss: `${baseUrl}/rss.xml` };
    }
    default:
      throw new Error(`Unknown tool: ${name}. See tools/list for available tools.`);
  }
}

// Core MCP POST handler — exported so /.well-known/mcp can reuse it for
// the live handshake (orank checks for POST handling on the well-known URL).
export async function handleMcpPost(request) {
  const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;

  let body;
  try {
    body = await request.json();
  } catch {
    return jrpcErr(null, -32700, "Parse error: invalid JSON body");
  }

  const { id = null, method, params } = body || {};
  if (!method) return jrpcErr(id, -32600, "Invalid Request: missing method");

  if (method === "initialize") {
    return jrpcOk(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        // MCP Apps: agents can fetch ui:// HTML resources to render
        // playable episode cards / search-result lists inline.
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: SERVER_INFO,
    });
  }
  if (method === "ping") return jrpcOk(id, {});
  if (method === "tools/list") return jrpcOk(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (!name) return jrpcErr(id, -32602, "Invalid params: missing tool name");
    try {
      const result = callTool(name, args, baseUrl);
      // MCP Apps: hand the agent a ui:// resource alongside the JSON.
      // Agents that don't know about MCP Apps just ignore _meta.
      const uiUri = uiResourceForTool(name, args, result);
      return jrpcOk(id, {
        content: textContent(result),
        isError: false,
        ...(uiUri ? { _meta: { "ui": { resourceUri: uiUri } } } : {}),
      });
    } catch (e) {
      return jrpcOk(id, {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      });
    }
  }
  if (method === "resources/list") {
    return jrpcOk(id, { resources: listUiResources(baseUrl) });
  }
  if (method === "resources/templates/list") {
    return jrpcOk(id, { resourceTemplates: listUiResourceTemplates() });
  }
  if (method === "resources/read") {
    const uri = params?.uri;
    if (!uri) return jrpcErr(id, -32602, "Invalid params: missing uri");
    try {
      const html = buildUiResource(uri, baseUrl);
      if (!html) return jrpcErr(id, -32602, `Unknown resource uri: ${uri}`);
      return jrpcOk(id, {
        contents: [{ uri, mimeType: "text/html", text: html }],
      });
    } catch (e) {
      return jrpcErr(id, -32603, `Failed to render ${uri}: ${e.message}`);
    }
  }

  return jrpcErr(id, -32601, `Method not found: ${method}`);
}

// Manifest-style summary for GET. Friendly for curl/browser inspection.
export function buildMcpGetManifest(baseUrl) {
  return {
    server: SERVER_INFO,
    protocolVersion: PROTOCOL_VERSION,
    transport: "streamable-http",
    endpoint: `${baseUrl}/mcp`,
    methods: ["initialize", "ping", "tools/list", "tools/call"],
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    docs: `${baseUrl}/.well-known/openapi.json`,
  };
}

export const onRequestPost = ({ request }) => handleMcpPost(request);

export async function onRequestGet({ request }) {
  const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
  return new Response(JSON.stringify(buildMcpGetManifest(baseUrl)), {
    status: 200,
    headers: apiHeaders(),
  });
}

const reject = () => errors.methodNotAllowed("GET, POST, OPTIONS");
export const onRequestPut = reject;
export const onRequestDelete = reject;
export const onRequestPatch = reject;

export const onRequestOptions = corsPreflight;
