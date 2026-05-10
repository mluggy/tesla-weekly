// /api/* catchall — any unknown path under /api/ returns a structured
// JSON 404 envelope so agents don't get HTML back from the SPA fallback.

import { apiError, corsPreflight } from "../_api.js";

function notFound({ request }) {
  const url = new URL(request.url);
  return apiError({
    status: 404,
    code: "endpoint_not_found",
    message: `No API endpoint at ${url.pathname}.`,
    hint: "/api/llms.txt — full list of supported endpoints",
  });
}

export const onRequestGet = notFound;
export const onRequestPost = notFound;
export const onRequestPut = notFound;
export const onRequestDelete = notFound;
export const onRequestPatch = notFound;
export const onRequestOptions = corsPreflight;
