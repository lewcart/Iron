// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Capacitor bridge before silhouette.ts imports it.
vi.mock('./native/person-segmentation', () => ({
  isPersonSegmentationAvailable: vi.fn(() => true),
  segmentPerson: vi.fn(async () => ({
    // 1x1 white PNG
    maskPngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=',
    durationMs: 12,
  })),
}));

import { ensureMask } from './silhouette';
import * as native from './native/person-segmentation';

const photo = {
  uuid: 'photo-1',
  blob_url: 'https://blob.example/p.jpg',
  mask_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.isPersonSegmentationAvailable).mockReturnValue(true);
  // 1x1 jpeg fetch
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (typeof url === 'string' && url.includes('/mask')) {
      return new Response(JSON.stringify({ mask_url: 'https://blob.example/p-mask.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Pass Uint8Array directly (don't wrap in Blob) — Node 20's Blob doesn't
    // expose .stream() the way Node 22+ does, and undici's Response reader
    // calls input.stream() during await res.blob(). Set content-type
    // explicitly so the JPEG type metadata isn't lost.
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/jpeg' },
    });
  }) as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

describe('ensureMask', () => {
  it('short-circuits when mask_url already set (cache hit)', async () => {
    const cached = { uuid: 'p2', blob_url: 'x', mask_url: 'https://existing/mask.png' };
    const res = await ensureMask(cached, 'progress');
    expect(res).toEqual({ maskUrl: 'https://existing/mask.png', computed: false });
    expect(native.segmentPerson).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws on web (no Capacitor plugin)', async () => {
    vi.mocked(native.isPersonSegmentationAvailable).mockReturnValue(false);
    await expect(ensureMask(photo, 'progress')).rejects.toThrow(/iOS app/);
  });

  it('fetches → segments → uploads → returns the URL on cache miss', async () => {
    const res = await ensureMask(photo, 'progress');
    expect(res).toEqual({ maskUrl: 'https://blob.example/p-mask.png', computed: true });
    expect(native.segmentPerson).toHaveBeenCalledTimes(1);
    // fetch called twice: once for source jpeg, once for upload
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent calls for the same uuid', async () => {
    const [a, b] = await Promise.all([
      ensureMask(photo, 'progress'),
      ensureMask(photo, 'progress'),
    ]);
    expect(a).toEqual(b);
    // Only one round-trip even though two callers asked
    expect(native.segmentPerson).toHaveBeenCalledTimes(1);
  });

  it('routes by kind (projection)', async () => {
    await ensureMask(photo, 'projection');
    const calls = vi.mocked(global.fetch).mock.calls;
    const uploadCall = calls.find((c) => String(c[0]).includes('/projection-photos/'));
    expect(uploadCall).toBeDefined();
  });

  it('aborts via AbortController', async () => {
    vi.mocked(native.segmentPerson).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { maskPngBase64: 'AAAA', durationMs: 50 };
    });
    const controller = new AbortController();
    const p = ensureMask(photo, 'progress', controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow();
  });
});
