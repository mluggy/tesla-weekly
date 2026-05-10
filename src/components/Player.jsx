import { Rewind, Play, Pause, FastForward, ClosedCaptioning, SkipBack, SkipForward, DownloadSimple, SpotifyLogo, ApplePodcastsLogo, YoutubeLogo, AmazonLogo } from "@phosphor-icons/react";
import config from "../utils/config";
import { APPLE_SHOW, SPOTIFY_SHOW, YOUTUBE_PLAYLIST, AMAZON_SHOW } from "../utils/platforms";
import { trackSubscribe, trackDownload } from "../utils/analytics";
import useSrt, { useActiveCue } from "../hooks/useSrt";

const L = config.labels;

const PLAYER_PLATFORMS = [
  { url: SPOTIFY_SHOW, urlKey: "spotifyUrl", Icon: SpotifyLogo, hoverColor: "#1DB954", title: L.spotify },
  { url: APPLE_SHOW, urlKey: "appleUrl", Icon: ApplePodcastsLogo, hoverColor: "#9b59b6", title: L.apple },
  { url: YOUTUBE_PLAYLIST, urlKey: "youtubeUrl", Icon: YoutubeLogo, hoverColor: "#FF0000", title: L.youtube },
  { url: AMAZON_SHOW, urlKey: "amazonUrl", Icon: AmazonLogo, hoverColor: "#00A8E1", title: L.amazon },
];

const SPEEDS = [0.8, 1, 1.2, 1.5, 2];

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.floor(Math.abs(sec) % 60);
  const sign = sec < 0 ? "-" : "";
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

export default function Player({ player, onPrevEpisode, onNextEpisode, hasPrev, hasNext }) {
  const {
    playingEp,
    isPlaying,
    currentTime,
    duration,
    speed,
    showSubs,
    togglePlay,
    seek,
    setSpeed,
    skipBack,
    skipForward,
    toggleSubs,
  } = player;

  const cues = useSrt(playingEp);
  const activeCue = useActiveCue(cues, currentTime);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleScrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rawPct = (e.clientX - rect.left) / rect.width;
    const pct = config.direction === "rtl" ? 1 - rawPct : rawPct;
    const clampedPct = Math.max(0, Math.min(1, pct));
    seek(clampedPct * duration);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 150,
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
      }}
    >
      {/* Subtitle row — visible only when CC is on AND the episode has an SRT */}
      {showSubs && playingEp?.hasSrt && (
        <div
          style={{
            borderBottom: "1px solid var(--border)",
          }}
        >
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: "0 20px",
            fontSize: 16,
            lineHeight: 1.7,
            color: activeCue ? "var(--text)" : "var(--text-faint)",
            textAlign: "center",
            direction: config.direction,
            height: 65,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {activeCue ? activeCue.text : "\u00A0"}
        </div>
        </div>
      )}

      {/* Progress bar — padded for easier clicking */}
      <div
        role="slider"
        aria-label={L.skip_forward ? "Progress" : "Progress"}
        aria-valuenow={Math.round(currentTime)}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        tabIndex={0}
        onClick={handleScrub}
        style={{
          width: "100%",
          padding: "8px 0",
          marginTop: -8,
          cursor: "pointer",
          direction: config.direction,
        }}
      >
        <div
          style={{
            width: "100%",
            height: 3,
            background: "var(--border)",
            borderRadius: 2,
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: config.direction === "rtl"
                ? "linear-gradient(to left, var(--accent), var(--accent-hover))"
                : "linear-gradient(to right, var(--accent-hover), var(--accent))",
              borderRadius: 2,
              transition: "width 0.1s linear",
              marginRight: config.direction === "rtl" ? 0 : undefined,
              marginLeft: config.direction === "rtl" ? "auto" : undefined,
            }}
          />
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "6px 10px 10px",
          // Match EpisodeRow's effective start inset (margin -3 + padding 7 = 4)
          // so the play button vertically aligns with the row play buttons.
          paddingInlineStart: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {/* Play/Pause — aligned with episode list play buttons */}
        <button
          onClick={togglePlay}
          title={isPlaying ? L.pause : L.play}
          aria-label={isPlaying ? L.pause : L.play}
          style={{
            width: 42,
            height: 40,
            borderRadius: "50%",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 18,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginInlineStart: 2,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--accent)";
          }}
        >
          {isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
        </button>

        {/* Prev episode */}
        {hasPrev && (
          <button
            onClick={onPrevEpisode}
            title={L.previous_episode}
            aria-label={L.previous_episode}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-dim)",
              padding: 8,
              display: "flex",
              flexShrink: 0,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {config.direction === "rtl" ? <SkipForward size={16} weight="fill" /> : <SkipBack size={16} weight="fill" />}
          </button>
        )}

        {/* Skip back (-15s) */}
        <button
          onClick={skipBack}
          title={L.skip_back}
          aria-label={L.skip_back}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-dim)",
            padding: 8,
            display: "flex",
            flexShrink: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
        >
          {config.direction === "rtl" ? <FastForward size={18} weight="fill" /> : <Rewind size={18} weight="fill" />}
        </button>

        {/* Skip forward (+15s) */}
        <button
          onClick={skipForward}
          title={L.skip_forward}
          aria-label={L.skip_forward}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-dim)",
            padding: 8,
            display: "flex",
            flexShrink: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
        >
          {config.direction === "rtl" ? <Rewind size={18} weight="fill" /> : <FastForward size={18} weight="fill" />}
        </button>

        {/* Next episode */}
        {hasNext && (
          <button
            onClick={onNextEpisode}
            title={L.next_episode}
            aria-label={L.next_episode}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-dim)",
              padding: 8,
              display: "flex",
              flexShrink: 0,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {config.direction === "rtl" ? <SkipBack size={16} weight="fill" /> : <SkipForward size={16} weight="fill" />}
          </button>
        )}

        {/* Title and time — desktop only */}
        <div className="player-title" style={{ flex: 1, minWidth: 0, padding: "0 4px" }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {playingEp?.title}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-faint)",
              fontVariantNumeric: "tabular-nums",
              marginTop: 2,
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>

        {/* Platform icons — sit flush against CC/Speed/EQ so the title
             (which has flex:1) absorbs all remaining space. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginInlineStart: "auto" }}>
          {PLAYER_PLATFORMS.filter((p) => p.url || playingEp?.[p.urlKey]).map((p, i) => (
            <a
              key={p.title}
              href={playingEp?.[p.urlKey] || p.url}
              target="_blank"
              rel="noopener"
              title={p.title}
              aria-label={p.title}
              onClick={() => trackSubscribe(p.title, "player", playingEp?.id)}
              className={i >= 3 ? "player-platforms-extra" : undefined}
              style={{
                color: "var(--text-faint)",
                display: "flex",
                padding: 2,
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = p.hoverColor; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-faint)"; }}
            >
              <p.Icon size={20} weight="fill" />
            </a>
          ))}
        </div>

        {/* Download */}
        <a
          className="player-platforms-extra"
          href={playingEp ? `/${playingEp.audioFile}` : "#"}
          download={playingEp ? `${L.episode} ${playingEp.id} - ${playingEp.title}.mp3` : ""}
          onClick={() => playingEp && trackDownload(playingEp.id, "player")}
          title={L.download}
          aria-label={L.download}
          style={{
            color: "var(--text-faint)",
            padding: 2,
            display: "flex",
            flexShrink: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-faint)"; }}
        >
          <DownloadSimple size={20} weight="fill" />
        </a>

        {/* CC toggle — hidden when the episode has no SRT */}
        {playingEp?.hasSrt && (
        <button
          className="player-cc"
          onClick={toggleSubs}
          title={L.subtitles}
          aria-label={L.subtitles}
          style={{
            height: 22,
            padding: "0 8px",
            borderRadius: 6,
            border: showSubs
              ? "1.5px solid var(--accent)"
              : "1.5px solid var(--border)",
            background: showSubs ? "var(--accent-bg)" : "transparent",
            color: showSubs ? "var(--accent)" : "var(--text-faint)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            boxSizing: "border-box",
          }}
        >
          <ClosedCaptioning size={14} weight={showSubs ? "fill" : "regular"} />
        </button>
        )}

        {/* Speed toggle — after CC on mobile, before CC on desktop */}
        <button
          className="player-speed"
          onClick={() => {
            const idx = SPEEDS.indexOf(speed);
            const next = SPEEDS[(idx + 1) % SPEEDS.length];
            setSpeed(next);
          }}
          title={L.playback_speed}
          aria-label={L.playback_speed}
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: 11,
            height: 22,
            padding: "0",
            borderRadius: 6,
            cursor: "pointer",
            border: "1.5px solid var(--accent)",
            background: "var(--accent-bg)",
            color: "var(--accent)",
            transition: "all 0.15s",
            flexShrink: 0,
            width: 36,
            textAlign: "center",
            boxSizing: "border-box",
            paddingTop: 1,
          }}
        >
          {speed}x
        </button>

        {/* Equalizer — landscape + desktop only */}
        <div
          className="player-eq"
          style={{
            display: "none",
            alignItems: "flex-end",
            gap: 2,
            height: 22,
            width: 24,
            flexShrink: 0,
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const baseSpeed = speed || 1;
            const dur = (0.81 + i * 0.324) / baseSpeed;
            return (
              <div
                key={i}
                style={{
                  width: 3,
                  borderRadius: 1,
                  background: "var(--accent)",
                  height: "30%",
                  animation: isPlaying
                    ? `waveform ${dur.toFixed(2)}s ease-in-out infinite`
                    : "none",
                  animationDelay: `${i * 0.08}s`,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
