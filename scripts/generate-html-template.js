import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import config from "./load-config.js";

const html = readFileSync("dist/index.html", "utf8");
const episodes = JSON.parse(readFileSync("public/episodes.json", "utf8"));

// Embed full transcript text into episodes for SSR rendering in the middleware.
// This stays in _episodes.js (middleware only) — never sent to the client.
for (const ep of episodes) {
  const txtPath = `episodes/${ep.audioFile.replace(".mp3", ".txt")}`;
  ep.fullText = existsSync(txtPath) ? readFileSync(txtPath, "utf8").trim() : "";
}

// Extract content between <head>...</head>
const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
const headContent = headMatch ? headMatch[1].trim() : "";

// Extract content between <body>...</body>
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
const bodyContent = bodyMatch ? bodyMatch[1].trim() : "";

// Strip tags that the middleware injects dynamically per-page
const cleanedHead = headContent
  .replace(/<title>[^<]*<\/title>\s*/i, "")
  .replace(/<meta\s+name="description"[^>]*>\s*/i, "")
  .replace(/<link\s+rel="canonical"[^>]*>\s*/i, "")
  .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, "")
  .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, "")
  .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\s*/i, "");

// SSR content lives in a hidden sibling of #root — visible to crawlers in
// the HTML source but never rendered by the browser. React renders the
// interactive app inside the empty #root.
//
// We also emit an sr-only <h1> + agent-doc anchors as separate siblings.
// `[hidden]` content is often skipped by no-JS HTML parsers (orank, naive
// crawlers), so anything inside the SSR block is invisible to them. The
// sr-only nodes are in raw HTML, not marked `hidden`/`display:none`/
// `aria-hidden`, so parsers count them as present, but CSS clipping keeps
// them invisible to sighted users.
const srOnlyAgentNav = [
  '<nav class="sr-only" aria-label="For AI agents">',
  '<a href="/AGENTS.md" rel="agent-docs">Agent integration guide</a>',
  '<a href="/api/llms.txt" rel="api-docs">API briefing for AI agents</a>',
  '<a href="/docs" rel="docs">Listener-agent docs</a>',
  '<a href="/.well-known/openapi.json" rel="service-desc">OpenAPI spec</a>',
  '<a href="/.well-known/agent.json" rel="describedby">Agent capability declaration</a>',
  '<a href="/mcp" rel="mcp">MCP server</a>',
  '<a href="/ask" rel="nlweb">Ask the show (NLWeb /ask)</a>',
  '</nav>',
].join("");

const bodyWithSsr = bodyContent.replace(
  '<div id="root"></div>',
  `<h1 class="sr-only">__SSR_H1__</h1>${srOnlyAgentNav}<div id="root"></div><div hidden>__SSR_CONTENT__</div>`
);

const template = `<!DOCTYPE html>
<html lang="${config.language}" dir="${config.direction}">
<head>
  <!--OG_TAGS-->
  <script nonce="{{CSP_NONCE}}">window.__EPISODE__=__EP_JSON__;window.__SEARCH__=__SEARCH_JSON__;</script>
  ${cleanedHead}
</head>
<body>
  ${bodyWithSsr}
</body>
</html>`;

mkdirSync("functions", { recursive: true });

// Export template as default string
writeFileSync(
  "functions/_html-template.js",
  `export default ${JSON.stringify(template)};\n`
);
console.log("Generated functions/_html-template.js");

// Export episodes as default
writeFileSync(
  "functions/_episodes.js",
  `export default ${JSON.stringify(episodes)};\n`
);
console.log("Generated functions/_episodes.js");

// Export podcast config for middleware
writeFileSync(
  "functions/_config.js",
  `export default ${JSON.stringify(config)};\n`
);
console.log("Generated functions/_config.js");
