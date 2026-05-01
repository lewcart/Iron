import { describe, it, expect } from 'vitest';
import { parseYouTubeUrl, looksLikeYouTubeUrl } from './youtube-url';

describe('parseYouTubeUrl', () => {
  it('parses a standard watch URL', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(r?.videoId).toBe('dQw4w9WgXcQ');
    expect(r?.startSeconds).toBe(0);
    expect(r?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('parses a youtu.be short URL', () => {
    const r = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(r?.videoId).toBe('dQw4w9WgXcQ');
    expect(r?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('parses an embed URL', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(r?.videoId).toBe('dQw4w9WgXcQ');
  });

  it('parses a shorts URL', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/shorts/abc12345xyz');
    expect(r?.videoId).toBe('abc12345xyz');
  });

  it('parses ?t=42 plain integer', () => {
    const r = parseYouTubeUrl('https://youtu.be/abc?t=42');
    expect(r?.startSeconds).toBe(42);
    expect(r?.canonicalUrl).toBe('https://www.youtube.com/watch?v=abc&t=42');
  });

  it('parses ?t=1m23s compact form', () => {
    const r = parseYouTubeUrl('https://youtu.be/abc?t=1m23s');
    expect(r?.startSeconds).toBe(83);
  });

  it('parses ?t=1h2m3s compact form', () => {
    const r = parseYouTubeUrl('https://youtu.be/abc?t=1h2m3s');
    expect(r?.startSeconds).toBe(3723);
  });

  it('parses ?start=42 (alternate param)', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=abc&start=42');
    expect(r?.startSeconds).toBe(42);
  });

  it('parses m.youtube.com mobile host', () => {
    const r = parseYouTubeUrl('https://m.youtube.com/watch?v=abc');
    expect(r?.videoId).toBe('abc');
  });

  it('returns null for non-YouTube URLs', () => {
    expect(parseYouTubeUrl('https://vimeo.com/12345')).toBeNull();
    expect(parseYouTubeUrl('https://example.com/watch?v=abc')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseYouTubeUrl('not a url')).toBeNull();
    expect(parseYouTubeUrl('')).toBeNull();
    expect(parseYouTubeUrl('   ')).toBeNull();
    expect(parseYouTubeUrl(null)).toBeNull();
    expect(parseYouTubeUrl(undefined)).toBeNull();
  });

  it('returns null for youtube.com without a video id', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/')).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/watch')).toBeNull();
  });

  it('handles bare-host paste without protocol', () => {
    const r = parseYouTubeUrl('youtu.be/abc?t=15');
    expect(r?.videoId).toBe('abc');
    expect(r?.startSeconds).toBe(15);
  });

  it('strips junk query params from canonical form', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=abc&feature=share&utm_source=ios');
    expect(r?.canonicalUrl).toBe('https://www.youtube.com/watch?v=abc');
  });
});

describe('looksLikeYouTubeUrl', () => {
  it('matches all forms', () => {
    expect(looksLikeYouTubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(looksLikeYouTubeUrl('https://youtu.be/abc')).toBe(true);
    expect(looksLikeYouTubeUrl('https://m.youtube.com/watch?v=abc')).toBe(true);
    expect(looksLikeYouTubeUrl('youtu.be/abc')).toBe(true);
  });

  it('rejects non-YouTube hosts', () => {
    expect(looksLikeYouTubeUrl('https://vimeo.com/12345')).toBe(false);
    expect(looksLikeYouTubeUrl('https://youtube-clone.example.com/watch?v=abc')).toBe(false);
    expect(looksLikeYouTubeUrl('garbage')).toBe(false);
  });
});
