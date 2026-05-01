// YouTube URL parsing + canonicalization for the exercise reference link.
//
// Stored values can be any of these forms (Lewis pastes whatever shows up
// in his clipboard):
//   https://www.youtube.com/watch?v=ABC123
//   https://youtu.be/ABC123
//   https://www.youtube.com/embed/ABC123
//   https://m.youtube.com/watch?v=ABC123
//   ...with or without ?t=42, ?t=1m23s, ?start=42, &t=42
//
// We normalize to a canonical form before opening to avoid weird WKWebView
// behavior with shortened/embed URLs and to apply the start-time consistently.
// Server-side validation (sync push, /api/exercises POST) uses the same
// regex test — keep it in sync if you change the host pattern below.

/** Result of parseYouTubeUrl. `canonicalUrl` is always
 *  `https://www.youtube.com/watch?v={videoId}[&t={s}]`. */
export interface ParsedYouTubeUrl {
  videoId: string;
  startSeconds: number;
  canonicalUrl: string;
}

/** Loose host check used by both client form-validation and server-side
 *  push validation. Matches youtube.com (any subdomain) and youtu.be. */
const YOUTUBE_HOST_RE = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?(?:youtube\.com|youtu\.be)\//i;

export function looksLikeYouTubeUrl(url: string): boolean {
  return YOUTUBE_HOST_RE.test(url.trim());
}

/** Extract videoId + start time. Returns null for any URL we can't parse.
 *  Callers should treat null as "this isn't a usable YouTube link" — show
 *  a validation error in forms, hide the open-link button at runtime. */
export function parseYouTubeUrl(url: string | null | undefined): ParsedYouTubeUrl | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!looksLikeYouTubeUrl(trimmed)) return null;

  let videoId: string | null = null;
  let parsed: URL;
  try {
    // URL constructor needs an absolute URL. Add https:// if the user pasted
    // a protocol-relative or bare-domain form ("youtu.be/ABC").
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host.endsWith('youtu.be')) {
    // youtu.be/ABC → path is /ABC
    videoId = parsed.pathname.replace(/^\/+/, '').split('/')[0] || null;
  } else if (host.endsWith('youtube.com')) {
    if (parsed.pathname.startsWith('/watch')) {
      videoId = parsed.searchParams.get('v');
    } else if (parsed.pathname.startsWith('/embed/')) {
      videoId = parsed.pathname.split('/')[2] || null;
    } else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/')[2] || null;
    }
  }
  if (!videoId) return null;

  // Start-time can be ?t=42, ?t=1m23s, ?t=1h2m3s, or ?start=42.
  const tParam = parsed.searchParams.get('t') ?? parsed.searchParams.get('start');
  const startSeconds = tParam ? parseTimeParam(tParam) : 0;

  const canonicalUrl = startSeconds > 0
    ? `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}`
    : `https://www.youtube.com/watch?v=${videoId}`;

  return { videoId, startSeconds, canonicalUrl };
}

/** Parse a t-param value into seconds. Handles plain integers ("42") and
 *  YouTube's hh-mm-ss compact form ("1h2m3s", "1m23s", "90s"). */
function parseTimeParam(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return 0;
  // Plain integer (most common).
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  // hh-mm-ss compact form. Match each unit independently so order tolerance.
  const hMatch = /(\d+)h/.exec(trimmed);
  const mMatch = /(\d+)m/.exec(trimmed);
  const sMatch = /(\d+)s/.exec(trimmed);
  const h = hMatch ? parseInt(hMatch[1], 10) : 0;
  const m = mMatch ? parseInt(mMatch[1], 10) : 0;
  const s = sMatch ? parseInt(sMatch[1], 10) : 0;
  const total = h * 3600 + m * 60 + s;
  return Number.isFinite(total) ? total : 0;
}

/** Open the parsed (canonical) form of a YouTube URL. iOS WKWebView routes
 *  www.youtube.com universal links to the YouTube app when installed, falls
 *  back to Safari otherwise. Returns false (no-op) for invalid URLs so the
 *  caller can hide the button rather than open garbage. */
export function openYouTube(rawUrl: string | null | undefined): boolean {
  const parsed = parseYouTubeUrl(rawUrl);
  if (!parsed) return false;
  if (typeof window === 'undefined') return false;
  window.open(parsed.canonicalUrl, '_blank', 'noopener');
  return true;
}
