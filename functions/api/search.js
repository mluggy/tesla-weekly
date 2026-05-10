// GET /api/search?q=<query>&limit=<1..50>
// Lightweight server-side search over title + description + transcript.
// Use this from agents that don't want to download search-index.json.

import { searchEpisodes } from "../_search.js";
import { apiOk, apiError, corsPreflight, errors } from "../_api.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam == null ? 10 : parseInt(limitParam, 10);
  if (limitParam != null && !Number.isFinite(parsedLimit)) {
    return apiError({
      status: 400,
      code: "bad_limit",
      message: "`limit` must be an integer between 1 and 50.",
      hint: "/api/search?q=ai&limit=10",
    });
  }
  const limit = Math.min(50, Math.max(1, parsedLimit || 10));

  if (!q) return errors.missingQuery();

  try {
    const t0 = Date.now();
    const baseUrl = `${url.protocol}//${url.host}`;
    const results = searchEpisodes(q, { limit, baseUrl });
    const took_ms = Date.now() - t0;

    return apiOk({ query: q, count: results.length, took_ms, results });
  } catch (e) {
    return errors.internal(e?.message);
  }
}

// Reject other methods with structured 405s — agents need a clean signal,
// not the implicit "GET only" that file-route conventions imply.
const reject = () => errors.methodNotAllowed("GET");
export const onRequestPost = reject;
export const onRequestPut = reject;
export const onRequestDelete = reject;
export const onRequestPatch = reject;

export const onRequestOptions = corsPreflight;
