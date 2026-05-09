#!/usr/bin/env python3
"""Generate one tech-digest episode end-to-end:
  Pass 1 — Grok with web+X search picks N stories.
  Pass 2 — Grok (medium reasoning, no tools) rewrites each story for audio.
  TTS    — xAI /v1/tts narrates the full transcript in a single call.
  Stitch — single ffmpeg concat: intro → body → outro.
Output lands in episodes/; coil's pipeline.yml then takes over.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable

import requests
from ruamel.yaml import YAML

sys.path.insert(0, os.path.dirname(__file__))
from shared import project_root, require_ffmpeg, validate_env_vars

ROOT = project_root()

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

EPISODES_DIR = ROOT / "episodes"
CONFIG_PATH = ROOT / "config" / "digest.yaml"
DEBUG_DIR = ROOT / ".tmp"
TARGET_SR = 24000

# xAI 2026 rates / limits.
TTS_PRICE_PER_MILLION_CHARS = 4.20
XAI_TTS_CHAR_LIMIT = 15000
XAI_RESPONSES_TIMEOUT_SEC = 1800
XAI_TTS_TIMEOUT_SEC = 300
TTS_RETRY_ATTEMPTS = 3
TTS_RETRY_BACKOFF_SEC = 3

# Reuse a single TCP+TLS connection across all xAI calls (5 per run).
SESSION = requests.Session()

yaml = YAML()
yaml.preserve_quotes = True
yaml.indent(mapping=2, sequence=4, offset=2)


# --- Cadence + dates --------------------------------------------------------

CADENCES = {"daily", "weekly", "biweekly", "monthly"}


def is_publish_day(cadence: str, today: date, last_pub: date | None) -> bool:
    """Used by --auto: should the cron actually publish today?"""
    if cadence == "daily":
        return today.weekday() < 5
    if cadence == "weekly":
        return today.weekday() == 0
    if cadence == "biweekly":
        if today.weekday() != 0:
            return False
        if last_pub is None:
            return True
        return (today - last_pub).days >= 14
    if cadence == "monthly":
        return today.day == 1
    raise ValueError(f"unknown cadence {cadence!r}")


def auto_content_dates(cadence: str, today: date) -> list[date]:
    if cadence == "daily":
        if today.weekday() == 0:  # Monday → Fri+Sat+Sun
            fri = today - timedelta(days=3)
            return [fri, fri + timedelta(days=1), fri + timedelta(days=2)]
        return [today - timedelta(days=1)]
    days = {"weekly": 7, "biweekly": 14, "monthly": 30}[cadence]
    return [today - timedelta(days=i) for i in range(days, 0, -1)]


def resolve_dates(args, cfg: dict, today: date,
                  last_pub: date | None) -> tuple[date, list[date]]:
    """Returns (publication_date, list_of_content_dates)."""
    if args.date:
        d = date.fromisoformat(args.date)
        return d, [d]
    if args.start and args.end:
        s = date.fromisoformat(args.start)
        e = date.fromisoformat(args.end)
        if e < s:
            raise SystemExit("--end must be >= --start")
        return e, [s + timedelta(days=i) for i in range((e - s).days + 1)]
    if args.auto:
        cadence = cfg["cadence"]
        if not args.force and not is_publish_day(cadence, today, last_pub):
            print(f"[skip] cadence={cadence} — today {today} is not a publish day",
                  file=sys.stderr)
            sys.exit(0)
        return today, auto_content_dates(cadence, today)
    raise SystemExit("Provide one of --date, --start/--end, or --auto")


def format_date_range(content_dates: list[date]) -> str:
    if len(content_dates) == 1:
        return content_dates[0].strftime("%b-%d, %Y")
    a = content_dates[0].strftime("%b-%d")
    b = content_dates[-1].strftime("%b-%d, %Y")
    return f"{a} to {b}"


# --- Manifest I/O -----------------------------------------------------------

def load_manifest() -> dict:
    with open(EPISODES_DIR / "episodes.yaml", "r", encoding="utf-8") as f:
        return yaml.load(f) or {"episodes": {}}


def write_manifest(data: dict) -> None:
    """Atomic write — a crash mid-write would corrupt episodes.yaml and
    break tomorrow's run."""
    target = EPISODES_DIR / "episodes.yaml"
    tmp = target.with_suffix(".yaml.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        yaml.dump(data, f)
    os.replace(tmp, target)


def next_episode_key(manifest: dict) -> int:
    """Sequential global counter — coil serves episodes at /{episode_num},
    so keys must be unique across all seasons."""
    keys = []
    for k in (manifest.get("episodes") or {}).keys():
        try:
            keys.append(int(k))
        except (TypeError, ValueError):
            pass
    return (max(keys) + 1) if keys else 1


def previous_titles(manifest: dict, lookback: int) -> list[str]:
    eps = manifest.get("episodes") or {}
    items = list(eps.items())

    def sort_key(kv):
        k, v = kv
        d = v.get("date") if isinstance(v, dict) else None
        if d:
            try:
                return (1, datetime.fromisoformat(str(d)))
            except ValueError:
                pass
        try:
            return (0, int(k))
        except (TypeError, ValueError):
            return (0, 0)

    items.sort(key=sort_key, reverse=True)
    return [v.get("title", "") for _, v in items[:lookback]
            if isinstance(v, dict) and v.get("title")]


def last_publish_date(manifest: dict) -> date | None:
    dates = []
    for v in (manifest.get("episodes") or {}).values():
        if isinstance(v, dict) and v.get("date"):
            try:
                dates.append(date.fromisoformat(str(v["date"])))
            except ValueError:
                pass
    return max(dates) if dates else None


# --- JSON salvage helpers (used by both Pass 1 and Pass 2 parsers) ----------

_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)


def _strip_fence(s: str) -> str:
    m = _FENCE_RE.search(s)
    return m.group(1) if m else s


def _scrape_objects(s: str, predicate: Callable[[dict], bool]) -> list[dict]:
    """Walk every `{` in s, try to decode a JSON object, keep ones matching
    `predicate`. Used to rebuild a stories[] array from a truncated response."""
    decoder = json.JSONDecoder()
    out: list[dict] = []
    pos = 0
    while True:
        idx = s.find("{", pos)
        if idx == -1:
            return out
        try:
            obj, end = decoder.raw_decode(s, idx)
            pos = end
        except json.JSONDecodeError:
            pos = idx + 1
            continue
        if isinstance(obj, dict) and predicate(obj):
            out.append(obj)


# --- xAI Grok ---------------------------------------------------------------

PASS1_PROMPT = """You are the editor of a {cadence} {show_name} podcast on {focus_areas}. Your job: pick the {n} most important, surprising, or jaw-dropping stories from the period {date_range}.

Use your web search and X/Twitter search tools aggressively to gather fresh, real-time coverage. Merge multiple sources covering the same event into ONE story. Rank by real-world impact, surprise value, funding size, strategic importance, or cultural ripple — not source count.

DO NOT pick any story whose title appears in the "Previously covered titles" list below.

Return a SINGLE JSON object — no markdown fences, no prose around it — matching this schema EXACTLY:
{{
  "episode_title": "<6–10 word newsletter-style title for the whole episode>",
  "episode_description": "<25–40 word factual summary of WHAT this episode covers. Just describe the contents — name 2–3 of the most important stories or themes. NO meta-tags about the show. BANNED phrases (and any variant): 'here's the jaw-dropping stuff', 'here are the X stories that matter', 'here's what matters most', 'the most important stories', 'today on the show', 'tune in', 'don't miss'. Write it as if you're explaining to someone what's IN the episode, not selling them on listening.>",
  "stories": [
    {{"title": "<short, punchy headline, max 10 words>", "brief": "<1-sentence factual summary identifying the company and what happened — input to the writer pass>"}}
  ]
}}

Exactly {n} stories in the array. Each "title" must be uniquely informative on its own.

Previously covered titles to avoid:
{prev_titles_block}
"""

PASS2_PROMPT = """You are the writer for {show_name} — a {cadence} {focus_areas} show heard by the SAME listeners every day. Your hardest job: make them feel like they got an INSIDER'S edge, not a Wikipedia summary read aloud.

For each story below, write ONE spoken paragraph of about **{words_per_story} words** (hard cap — count them, do not exceed). Each paragraph stands entirely on its own.

THE INSIGHT TEST — every paragraph must contain at least ONE of these:
  (a) A specific 6–18 month prediction with a named consequence ("Salesforce loses its mid-market wedge by Q3")
  (b) A contrarian take that runs against current coverage ("The funding number is the sideshow; the real story is the data licensing clause buried in the deal")
  (c) A second-order consequence other reporting hasn't connected ("Watch what happens to the API margin when this hits enterprise SLAs")
  (d) What a NAMED competitor or customer is forced to do now ("This forces Anthropic to either match the API price or pivot to enterprise-only")

If you cannot land one of (a)–(d), the story doesn't belong in the show — write the paragraph anyway but flag it implicitly by leading with a sharper question.

CRITICAL — DON'T RESTATE THE HEADLINE:
The title is read out loud immediately BEFORE your paragraph. Listeners just heard it. Your first sentence must NOT echo the headline's facts in different words. Don't reintroduce the company by name (it's already in the title) and don't repeat what the title already said happened. Use sentence one to ADD an angle, a stake, a number that wasn't in the title, or a contradiction — never to summarize what was just announced.

Bad first sentence (restates "OpenAI Launches Self-Serve Ads Platform for ChatGPT"):
  "OpenAI's Ads Manager turns every ChatGPT prompt into bidable inventory."
Good first sentence (adds the angle):
  "Every ChatGPT prompt now carries an auction in the background — the first model where the ad sees the entire conversation, not a keyword."

HARD RULES:

1. NO transitions between stories. Banned openers and any variant: "speaking of", "meanwhile", "now, over at", "and finally", "in other news", "switching gears", "buckle up". The natural pause between paragraphs IS the transition — your words must not be it.

2. NO rote financial dumps. Skip "raising X bringing total funding to Y at Z valuation" unless the *ratio* or *trajectory* is itself the insight. One number is plenty per paragraph; pick the one that lands.

3. NO "and here's why this matters" tag, NO "this could change everything", NO "the implications are massive". Don't NAME the importance — DEMONSTRATE it through a specific second-order claim.

4. Banned filler: "game-changing", "the AI revolution", "disruptive", "watch this space", "stay tuned", "let that sink in", "needless to say", "the bottom line is", "make no mistake", "what's clear is".

5. Vary sentence length AGGRESSIVELY. Short sentences land. Long ones flow. Mix them. NEVER write three medium-length sentences in a row.

6. The company is already named in the title — DO NOT re-name it in the first sentence unless it's necessary for grammar. If they aren't a household name and the title alone is opaque, slip the one-phrase "what they do" inline within the first 1–2 sentences (not parenthetically).

7. Vary openers across paragraphs — never repeat structure twice in a row. Rotate among: a hard stat, a contradiction, a question, a direct action verb, a quote, a counter-intuitive observation.

8. Vary endings. Some kicker, some just stop. NEVER signal "wrapping up."

9. You MAY use spoken tags sparingly — at most one per paragraph: [pause] for a half-beat, <emphasis>word</emphasis> for stress. Don't decorate.

10. NO callbacks to other stories — you don't know episode order.

11. Output ONLY the paragraph prose — no title prefix, no "Story:" label, no quotes around it.

Input stories:
{stories_block}

Return a SINGLE JSON object — no markdown fences, no prose around it:
{{
  "expansions": [
    {{"title": "<exactly as given>", "description": "<your ~{words_per_story} word spoken paragraph>"}}
  ]
}}

Exactly one entry per input story, in the same order.
"""


def call_xai_responses(cfg: dict, user_input: str, api_key: str,
                       reasoning: str, with_tools: bool,
                       label: str) -> tuple[str, float]:
    """POST to xAI Responses API. Returns (assistant_text, cost_usd)."""
    payload = {
        "model": cfg["xai_model"],
        "reasoning": {"effort": reasoning},
        "input": user_input,
    }
    if with_tools:
        payload["tools"] = [{"type": "web_search"}, {"type": "x_search"}]
    headers = {"Content-Type": "application/json",
               "Authorization": f"Bearer {api_key}"}
    print(f"[xai/{label}] POST reasoning={reasoning} tools={with_tools}",
          file=sys.stderr)
    t0 = time.time()
    r = SESSION.post(cfg["xai_endpoint"], json=payload, headers=headers,
                     timeout=XAI_RESPONSES_TIMEOUT_SEC)
    if r.status_code >= 400:
        raise RuntimeError(f"xAI {r.status_code}: {r.text[:1500]}")
    body = r.json()
    DEBUG_DIR.mkdir(exist_ok=True)
    (DEBUG_DIR / f"last_xai_{label}.json").write_text(
        json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")

    # cost_in_usd_ticks is in nano-dollars (1e-9 USD).
    usage = body.get("usage") or {}
    cost = (usage.get("cost_in_usd_ticks") or 0) / 1e9
    print(f"[xai/{label}] {time.time()-t0:.1f}s, "
          f"input={usage.get('input_tokens',0)} "
          f"output={usage.get('output_tokens',0)} "
          f"cost=${cost:.4f}", file=sys.stderr)

    text = body.get("output_text") or ""
    if not text.strip():
        for item in body.get("output") or []:
            if item.get("type") != "message":
                continue
            for c in item.get("content") or []:
                if isinstance(c, dict) and c.get("type", "").startswith("output_text"):
                    if isinstance(c.get("text"), str):
                        text += c["text"]
    if not text.strip():
        raise RuntimeError(f"xAI/{label} returned no assistant text. "
                           f"See .tmp/last_xai_{label}.json")
    return text, cost


def parse_pass1_json(raw: str) -> dict:
    """Robust to truncation: salvages title/description via regex if the
    wrapper JSON is incomplete; rebuilds 'stories' from any complete
    {title, brief} objects in the text."""
    s = _strip_fence(raw.strip())
    try:
        obj = json.loads(s)
        if all(k in obj for k in ("episode_title", "episode_description", "stories")):
            return obj
    except json.JSONDecodeError:
        pass

    def grab(field: str) -> str | None:
        m = re.search(rf'"{field}"\s*:\s*"((?:[^"\\]|\\.)*)"', s)
        return json.loads(f'"{m.group(1)}"') if m else None

    stories = _scrape_objects(s, lambda o: (
        isinstance(o.get("title"), str)
        and isinstance(o.get("brief"), str)
        and "stories" not in o
    ))
    salvaged = {
        "episode_title": grab("episode_title"),
        "episode_description": grab("episode_description"),
        "stories": [{"title": o["title"], "brief": o["brief"]} for o in stories],
    }
    if not all(salvaged.values()):
        DEBUG_DIR.mkdir(exist_ok=True)
        (DEBUG_DIR / "last_pass1_raw.txt").write_text(raw, encoding="utf-8")
        raise ValueError(f"Pass 1 JSON unsalvageable. Have: "
                         f"{ {k: bool(v) for k, v in salvaged.items()} }. "
                         f"Raw saved to .tmp/last_pass1_raw.txt")
    print(f"[warn] Pass 1 response was truncated; salvaged "
          f"{len(stories)} stories", file=sys.stderr)
    return salvaged


def build_pass1_input(cfg: dict, content_dates: list[date],
                      prev_titles: list[str]) -> str:
    prev_block = ("\n".join(f"- {t}" for t in prev_titles)
                  if prev_titles else "(none)")
    return PASS1_PROMPT.format(
        cadence=cfg["cadence"],
        show_name=cfg["show_name"],
        focus_areas=cfg["focus_areas"],
        n=cfg["num_stories"],
        date_range=format_date_range(content_dates),
        prev_titles_block=prev_block,
    )


def _expand_batch(cfg: dict, batch_idx: int, chunk: list[dict],
                  api_key: str) -> tuple[list[dict], float]:
    """One Pass-2 call for a batch of stories. Returns (expansions, cost)."""
    stories_block = json.dumps(
        [{"title": s["title"], "brief": s["brief"]} for s in chunk],
        ensure_ascii=False, indent=2)
    prompt = PASS2_PROMPT.format(
        show_name=cfg["show_name"],
        cadence=cfg["cadence"],
        focus_areas=cfg["focus_areas"],
        words_per_story=int(cfg["words_per_story"]),
        stories_block=stories_block,
    )
    raw, cost = call_xai_responses(
        cfg, prompt, api_key,
        reasoning=cfg["pass2_reasoning"],
        with_tools=False,
        label=f"pass2_b{batch_idx}")

    s = _strip_fence(raw.strip())
    try:
        expansions = json.loads(s).get("expansions", [])
    except json.JSONDecodeError:
        expansions = _scrape_objects(s, lambda o: (
            isinstance(o.get("title"), str)
            and isinstance(o.get("description"), str)
        ))

    by_title = {e["title"].strip(): e["description"]
                for e in expansions if isinstance(e, dict)}
    out: list[dict] = []
    for j, src in enumerate(chunk):
        desc = by_title.get(src["title"].strip())
        if desc is None and j < len(expansions):
            desc = expansions[j].get("description")
        if not desc:
            desc = src["brief"]
            print(f"[warn] Pass 2 missed story: {src['title']!r} — using brief",
                  file=sys.stderr)
        out.append({"title": src["title"], "description": desc.strip()})
    return out, cost


def expand_stories(cfg: dict, stories: list[dict],
                   api_key: str) -> tuple[list[dict], float]:
    """Run all Pass-2 batches in parallel — they're independent HTTP calls.
    Returns (expansions in original story order, total cost)."""
    batch_size = max(1, int(cfg["pass2_batch_size"]))
    batches = [stories[i:i + batch_size]
               for i in range(0, len(stories), batch_size)]
    results: list[tuple[list[dict], float] | None] = [None] * len(batches)

    with ThreadPoolExecutor(max_workers=min(len(batches), 5)) as ex:
        future_to_idx = {
            ex.submit(_expand_batch, cfg, i + 1, chunk, api_key): i
            for i, chunk in enumerate(batches)
        }
        for fut in as_completed(future_to_idx):
            i = future_to_idx[fut]
            results[i] = fut.result()

    out: list[dict] = []
    total_cost = 0.0
    for r in results:
        assert r is not None
        out.extend(r[0])
        total_cost += r[1]
    return out, total_cost


# --- xAI TTS + ffmpeg stitch ------------------------------------------------

def call_xai_tts(text: str, cfg: dict, api_key: str, out_path: Path) -> int:
    """POST text to xAI /v1/tts, write returned audio bytes to out_path.
    Returns the number of characters sent (for cost accounting)."""
    payload = {
        "text": text,
        "voice_id": cfg["xai_voice_id"],
        "language": cfg["xai_tts_language"],
    }
    headers = {"Content-Type": "application/json",
               "Authorization": f"Bearer {api_key}"}
    r = SESSION.post(cfg["xai_tts_endpoint"], json=payload,
                     headers=headers, timeout=XAI_TTS_TIMEOUT_SEC)
    if r.status_code >= 400:
        raise RuntimeError(f"xAI TTS {r.status_code}: {r.text[:1000]}")
    out_path.write_bytes(r.content)
    return len(text)


def make_silence_wav(ms: int, path: Path) -> None:
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", f"anullsrc=r={TARGET_SR}:cl=mono",
        "-t", f"{ms / 1000:.3f}",
        "-c:a", "pcm_s16le",
        str(path),
    ], check=True)


def ffmpeg_concat(parts: list[Path], out: Path) -> None:
    """Stitch mixed PCM/MP3 inputs into one PCM WAV. Uses the concat FILTER
    (decodes each input first) — the concat DEMUXER would silently produce
    garbage when sample rates or codecs differ between inputs."""
    n = len(parts)
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in parts:
        cmd += ["-i", str(p)]
    parts_filter = "".join(
        f"[{i}:a]aresample={TARGET_SR},aformat=channel_layouts=mono[a{i}];"
        for i in range(n)
    )
    concat_inputs = "".join(f"[a{i}]" for i in range(n))
    filter_complex = parts_filter + f"{concat_inputs}concat=n={n}:v=0:a=1[out]"
    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-ar", str(TARGET_SR), "-ac", "1",
        "-c:a", "pcm_s16le",
        str(out),
    ]
    subprocess.run(cmd, check=True)


def wav_duration_sec(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


# --- TTS + stitch ----------------------------------------------------------

def synthesize_episode(cfg: dict, spoken_segments: list[str], basename: str,
                       intro_path: Path, outro_path: Path, wav_out: Path,
                       api_key: str) -> int:
    """Single-call TTS over the joined transcript (preserves voice consistency
    across stories), then stitch intro · TTS body · outro into wav_out.
    Returns total characters sent to TTS for cost accounting."""
    full_text = "\n\n[pause]\n\n".join(spoken_segments)
    if len(full_text) > XAI_TTS_CHAR_LIMIT:
        sys.exit(f"Transcript too long for single TTS call "
                 f"({len(full_text)} chars > {XAI_TTS_CHAR_LIMIT}). "
                 f"Reduce num_stories or words_per_story.")

    tts_dir = DEBUG_DIR / f"tts_{basename}"
    if tts_dir.exists():
        shutil.rmtree(tts_dir)
    tts_dir.mkdir(parents=True)
    try:
        body_chunk = tts_dir / "body.mp3"
        print(f"[tts] xAI voice_id={cfg['xai_voice_id']} "
              f"single-call {len(full_text)} chars", file=sys.stderr)
        for attempt in range(TTS_RETRY_ATTEMPTS):
            try:
                t0 = time.time()
                call_xai_tts(full_text, cfg, api_key, body_chunk)
                print(f"[tts] body {len(full_text)} chars → "
                      f"{body_chunk.stat().st_size/1024:.0f}KB "
                      f"({time.time()-t0:.1f}s)", file=sys.stderr)
                break
            except Exception as e:
                print(f"[tts] attempt {attempt+1} failed: {e}", file=sys.stderr)
                if attempt == TTS_RETRY_ATTEMPTS - 1:
                    raise
                time.sleep(TTS_RETRY_BACKOFF_SEC * (attempt + 1))

        bumper = tts_dir / "_bumper_silence.wav"
        make_silence_wav(int(cfg["bumper_silence_ms"]), bumper)
        ffmpeg_concat(
            [intro_path, bumper, body_chunk, bumper, outro_path], wav_out)
    finally:
        shutil.rmtree(tts_dir, ignore_errors=True)

    return len(full_text)


# --- Main -------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Generate a tech-digest episode.")
    p.add_argument("--date", help="Single publication date YYYY-MM-DD")
    p.add_argument("--start", help="Range start YYYY-MM-DD (use with --end)")
    p.add_argument("--end", help="Range end YYYY-MM-DD (inclusive)")
    p.add_argument("--auto", action="store_true",
                   help="Cron-style: derive date(s) from cadence + today")
    p.add_argument("--force", action="store_true",
                   help="With --auto, ignore the cadence-day gate")
    p.add_argument("--on", dest="on_date",
                   help="Override 'today' for --auto (backfill simulation, YYYY-MM-DD)")
    args = p.parse_args()

    validate_env_vars(["XAI_API_KEY"])
    require_ffmpeg()
    xai_key = os.environ["XAI_API_KEY"]

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = yaml.load(f)
    if cfg["cadence"] not in CADENCES:
        sys.exit(f"cadence must be one of {sorted(CADENCES)}")

    manifest = load_manifest()
    today = date.fromisoformat(args.on_date) if args.on_date else date.today()
    pub_date, content_dates = resolve_dates(
        args, cfg, today, last_publish_date(manifest))
    season = pub_date.year
    ep_key = next_episode_key(manifest)
    basename = f"s{season}e{ep_key}"
    wav_out = EPISODES_DIR / f"{basename}.wav"
    mp3_out = EPISODES_DIR / f"{basename}.mp3"
    txt_out = EPISODES_DIR / f"{basename}.txt"
    if wav_out.exists() or mp3_out.exists():
        print(f"[skip] {basename} already exists", file=sys.stderr)
        return

    prev = previous_titles(manifest, int(cfg["lookback_episodes"]))
    print(f"[plan] pub={pub_date} content={[d.isoformat() for d in content_dates]} "
          f"basename={basename} prev_titles={len(prev)}", file=sys.stderr)

    p1_raw, p1_cost = call_xai_responses(
        cfg, build_pass1_input(cfg, content_dates, prev), xai_key,
        reasoning=cfg["pass1_reasoning"], with_tools=True, label="pass1")
    pass1 = parse_pass1_json(p1_raw)
    if len(pass1["stories"]) != cfg["num_stories"]:
        print(f"[warn] Pass 1 returned {len(pass1['stories'])} stories, "
              f"expected {cfg['num_stories']}", file=sys.stderr)

    expanded, p2_cost = expand_stories(cfg, pass1["stories"], xai_key)

    spoken_segments = [f"{e['title']}. {e['description']}" for e in expanded]
    txt_out.write_text("\n\n".join(spoken_segments), encoding="utf-8")
    print(f"[wrote] {txt_out}", file=sys.stderr)

    intro_path = ROOT / cfg["intro_wav"]
    outro_path = ROOT / cfg["outro_wav"]
    if not intro_path.exists() or not outro_path.exists():
        sys.exit(f"Missing intro/outro: {intro_path}, {outro_path}")

    total_chars = synthesize_episode(
        cfg, spoken_segments, basename, intro_path, outro_path, wav_out, xai_key)
    print(f"[wrote] {wav_out} ({wav_duration_sec(wav_out):.1f}s)", file=sys.stderr)

    tts_cost = total_chars / 1_000_000 * TTS_PRICE_PER_MILLION_CHARS
    total_cost = round(p1_cost + p2_cost + tts_cost, 4)
    eps = manifest.setdefault("episodes", {})
    eps[ep_key] = {
        "season": season,
        "title": pass1["episode_title"],
        "description": pass1["episode_description"],
        "cost": total_cost,
    }
    write_manifest(manifest)
    print(f"[wrote] episodes.yaml entry {ep_key} cost=${total_cost}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
