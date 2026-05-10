// Generates listener-facing Agent Skills (https://agentskills.io) under
// /.well-known/agent-skills/. Each skill is a SKILL.md describing one
// capability an agent can perform on behalf of a listener.
//
// The index.json is the v0.2.0 discovery format: each entry carries
// `type`, `url`, and `sha256:` digest of the artifact's raw bytes. Agents
// fetch the index, verify each artifact, and load instructions on demand.
//
// IMPORTANT: SKILL.md bodies use *relative* paths (e.g. `/api/search`)
// rather than {{SITE_URL}} placeholders. Relative paths keep the served
// bytes byte-stable across hostnames, so sha256 in the index matches what
// the agent fetches. The index itself does use {{SITE_URL}} for the
// `url` field; the middleware rewrites the index per-request and the
// digest doesn't depend on it.

import { createHash } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import config from "./load-config.js";

const SITE = "{{SITE_URL}}";
const SKILLS_DIR = "public/.well-known/agent-skills";
mkdirSync(SKILLS_DIR, { recursive: true });

const sha256 = (s) =>
  "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");

// ─── Skill definitions ────────────────────────────────────────────────────
const skills = [
  {
    name: "find-episode-by-topic",
    description:
      `Find a ${config.title} podcast episode covering a specific topic, person, or company. ` +
      "Use when a listener asks 'which episode covers <X>' or 'find the one about <Y>'. " +
      "Returns ranked matches with episode title, date, URL, and a transcript snippet.",
    body: [
      "# Find episode by topic",
      "",
      `Use this skill when a listener asks to find a specific ${config.title} episode by what it's about — a topic, a person, a company, or a keyword.`,
      "",
      "## How to use",
      "",
      "1. Call the search endpoint: `GET /api/search?q=<query>&limit=10` (relative to the site root).",
      "2. The response is JSON: `{ query, count, took_ms, results: [{ id, title, date, url, audio, transcript, score, snippet }] }`.",
      "3. Pick the top-ranked result (highest `score`) and present `title`, `date`, `url`, and `snippet` to the listener.",
      "4. Offer the audio URL or the episode page (`url`) so they can listen.",
      "",
      "## Alternatives",
      "",
      "- Native MCP clients can call the `search_episodes` tool at `/mcp`.",
      "- The full episode list with descriptions is at `/episodes/llms.txt`.",
      "- All episode metadata is at `/episodes.json`.",
    ].join("\n"),
  },
  {
    name: "search-transcripts",
    description:
      `Free-text search over all ${config.title} episode transcripts. ` +
      "Use when a listener asks 'did they mention <X>' or 'find the part about <Y>'. " +
      "Returns ranked episodes with snippet excerpts from the transcript.",
    body: [
      "# Search transcripts",
      "",
      `Search inside the spoken content of every ${config.title} episode.`,
      "",
      "## How to use",
      "",
      "1. Call `GET /api/search?q=<query>` — the search index covers titles, descriptions, and full transcripts.",
      "2. Each result includes a `snippet` showing where the match occurred.",
      "3. Link the listener to `url` (episode page) or `transcript` (raw `.txt`) for the full context.",
      "",
      "For offline indexing, the entire searchable corpus is at `/search-index.json`.",
    ].join("\n"),
  },
  {
    name: "get-latest-episode",
    description:
      `Return the most recently published ${config.title} episode with title, date, description, audio URL, and transcript URL. ` +
      "Use when a listener asks 'what's the new episode' or 'what just dropped'.",
    body: [
      "# Get latest episode",
      "",
      `Return the most recent ${config.title} episode published.`,
      "",
      "## How to use",
      "",
      "1. Fetch `/episodes.json` and pick the entry with the highest `id` (or call the MCP `get_latest_episode` tool).",
      "2. Present `title`, `date`, `desc`, `audio` URL, and the episode page URL.",
      "3. The agent JSON view at `/?mode=agent` also includes a `latestEpisode` block.",
    ].join("\n"),
  },
  {
    name: "list-episodes",
    description:
      `Return ${config.title} episodes in reverse-chronological order with metadata. ` +
      "Use when a listener wants to browse the catalog or see what episodes exist.",
    body: [
      "# List episodes",
      "",
      `Browse ${config.title} episodes from newest to oldest.`,
      "",
      "## How to use",
      "",
      "1. Fetch `/episodes.json` for the full machine-readable list, or `/episodes/llms.txt` for a markdown summary including descriptions, guests, topics, and chapters.",
      "2. MCP clients: call `list_episodes(limit, offset)` for paginated browse.",
      "3. RSS readers: subscribe via the canonical feed at `/rss.xml`.",
    ].join("\n"),
  },
  {
    name: "subscribe-via-rss",
    description:
      `Return the canonical RSS feed URL so a listener can subscribe to ${config.title} in their podcast app. ` +
      "Use when the listener says 'subscribe', 'follow', or asks how to get new episodes.",
    body: [
      "# Subscribe via RSS",
      "",
      `Give the listener the canonical ${config.title} RSS feed URL.`,
      "",
      "## How to use",
      "",
      "1. Hand them the URL: `/rss.xml` (resolve against the site root).",
      "2. Most podcast apps (Apple Podcasts, Pocket Casts, Overcast, Spotify) accept this URL directly via 'Add by URL' / 'Add by RSS'.",
      "3. Direct platform links may also be listed in `/llms.txt` under 'Listen'.",
    ].join("\n"),
  },
  {
    name: "get-episode",
    description:
      `Fetch full detail for a specific ${config.title} episode by its numeric ID. ` +
      "Use when a listener references an episode number, or after another skill has identified an episode and you need its full transcript.",
    body: [
      "# Get episode by ID",
      "",
      `Fetch the full record for one ${config.title} episode.`,
      "",
      "## How to use",
      "",
      "1. The episode page lives at `/<id>` (HTML) or `/<id>.md` (markdown) or `/<id>?mode=agent` (JSON).",
      "2. The transcript is at `/sNNeMM.txt` (plain text).",
      "3. MCP clients: call `get_episode(id)` for a single-call response with metadata + transcript.",
    ].join("\n"),
  },
];

// ─── Write SKILL.md files + index ──────────────────────────────────────────
const entries = [];

for (const skill of skills) {
  const dir = `${SKILLS_DIR}/${skill.name}`;
  mkdirSync(dir, { recursive: true });
  const md = [
    "---",
    `name: ${skill.name}`,
    `description: ${JSON.stringify(skill.description)}`,
    "metadata:",
    `  podcast: ${JSON.stringify(config.title)}`,
    `  language: ${JSON.stringify(config.language || "en")}`,
    "---",
    "",
    skill.body,
    "",
  ].join("\n");
  writeFileSync(`${dir}/SKILL.md`, md);
  entries.push({
    name: skill.name,
    description: skill.description,
    type: "skill-md",
    url: `${SITE}/.well-known/agent-skills/${skill.name}/SKILL.md`,
    sha256: sha256(md),
  });
}

const index = {
  $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  version: "0.2.0",
  name: config.title,
  description: `Listener-facing Agent Skills for ${config.title}`,
  url: `${SITE}/.well-known/agent-skills/index.json`,
  publisher: config.author || undefined,
  language: config.language || undefined,
  skills: entries,
};

writeFileSync(
  `${SKILLS_DIR}/index.json`,
  JSON.stringify(index, null, 2) + "\n"
);
console.log(`Generated agent-skills index with ${entries.length} skills`);
