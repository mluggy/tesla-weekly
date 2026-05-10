// GET /status — service health for agent circuit-breaker logic.
// Always 200 because the deployment is static; if this responds at all,
// the show is reachable and listings are valid.

import episodes from "./_episodes.js";
import config from "./_config.js";
import { apiOk, corsPreflight, errors } from "./_api.js";

export async function onRequestGet() {
  const sorted = [...episodes].sort((a, b) => b.id - a.id);
  const latest = sorted[0];
  return apiOk({
    status: "ok",
    name: config.title,
    description: config.description || "",
    version: "1.1.0",
    contentType: "podcast",
    language: config.language || undefined,
    episodeCount: sorted.length,
    latestEpisode: latest
      ? { id: latest.id, title: latest.title, datePublished: latest.date || undefined }
      : null,
    generated_at: new Date().toISOString(),
  });
}

const reject = () => errors.methodNotAllowed("GET, OPTIONS");
export const onRequestPost = reject;
export const onRequestPut = reject;
export const onRequestDelete = reject;
export const onRequestPatch = reject;

export const onRequestOptions = corsPreflight;
