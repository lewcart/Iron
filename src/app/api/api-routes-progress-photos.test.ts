import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ===== Mock @/db/queries =====

vi.mock('@/db/queries', () => ({
  listProgressPhotos: vi.fn(),
  createProgressPhoto: vi.fn(),
  deleteProgressPhoto: vi.fn(),
}));

// ===== Mock @vercel/blob =====

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}));

// ===== Fixtures =====

const mockPhoto = {
  uuid: 'photo-uuid-1',
  blob_url: 'https://blob.vercel-storage.com/progress-photos/photo-uuid-1-front.jpg',
  pose: 'front',
  notes: null,
  taken_at: '2026-03-20T09:00:00.000Z',
};

// ===== GET /api/progress-photos =====

describe('GET /api/progress-photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns progress photos with default limit', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listProgressPhotos).mockResolvedValue([mockPhoto]);

    const { GET } = await import('./progress-photos/route');
    const req = new NextRequest('http://localhost/api/progress-photos');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockPhoto]);
    expect(queries.listProgressPhotos).toHaveBeenCalledWith(50);
  });

  it('passes custom limit param', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listProgressPhotos).mockResolvedValue([]);

    const { GET } = await import('./progress-photos/route');
    const req = new NextRequest('http://localhost/api/progress-photos?limit=10');
    await GET(req);

    expect(queries.listProgressPhotos).toHaveBeenCalledWith(10);
  });
});

// ===== POST /api/progress-photos =====

describe('POST /api/progress-photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and returns a new progress photo', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createProgressPhoto).mockResolvedValue(mockPhoto);

    const { POST } = await import('./progress-photos/route');
    const req = new NextRequest('http://localhost/api/progress-photos', {
      method: 'POST',
      body: JSON.stringify({
        blob_url: 'https://blob.vercel-storage.com/progress-photos/photo-uuid-1-front.jpg',
        pose: 'front',
        notes: null,
        taken_at: '2026-03-20T09:00:00.000Z',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockPhoto);
    expect(queries.createProgressPhoto).toHaveBeenCalledWith({
      blob_url: 'https://blob.vercel-storage.com/progress-photos/photo-uuid-1-front.jpg',
      pose: 'front',
      notes: null,
      taken_at: '2026-03-20T09:00:00.000Z',
    });
  });

  it('returns 400 when blob_url is missing', async () => {
    const { POST } = await import('./progress-photos/route');
    const req = new NextRequest('http://localhost/api/progress-photos', {
      method: 'POST',
      body: JSON.stringify({ pose: 'front' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'blob_url and pose are required' });
  });

  it('returns 400 when pose is missing', async () => {
    const { POST } = await import('./progress-photos/route');
    const req = new NextRequest('http://localhost/api/progress-photos', {
      method: 'POST',
      body: JSON.stringify({ blob_url: 'https://example.com/photo.jpg' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'blob_url and pose are required' });
  });

  it('passes null for missing optional fields', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createProgressPhoto).mockResolvedValue(mockPhoto);

    const { POST } = await import('./progress-photos/route');
    const req = new NextRequest('http://localhost/api/progress-photos', {
      method: 'POST',
      body: JSON.stringify({
        blob_url: 'https://example.com/photo.jpg',
        pose: 'side',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);

    expect(queries.createProgressPhoto).toHaveBeenCalledWith({
      blob_url: 'https://example.com/photo.jpg',
      pose: 'side',
      notes: null,
      taken_at: undefined,
    });
  });
});

// ===== DELETE /api/progress-photos/[uuid] =====

describe('DELETE /api/progress-photos/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a progress photo and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteProgressPhoto).mockResolvedValue(undefined);

    const { DELETE } = await import('./progress-photos/[uuid]/route');
    const req = new NextRequest('http://localhost/api/progress-photos/photo-uuid-1', {
      method: 'DELETE',
    });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'photo-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteProgressPhoto).toHaveBeenCalledWith('photo-uuid-1');
  });
});

// ===== POST /api/progress-photos/upload =====

describe('POST /api/progress-photos/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads a file and returns the blob url', async () => {
    const blob = await import('@vercel/blob');
    vi.mocked(blob.put).mockResolvedValue({
      url: 'https://blob.vercel-storage.com/progress-photos/uuid-front.jpg',
    } as Awaited<ReturnType<typeof blob.put>>);

    const { POST } = await import('./progress-photos/upload/route');
    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pose', 'front');

    const req = new NextRequest('http://localhost/api/progress-photos/upload', {
      method: 'POST',
      body: formData,
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ url: 'https://blob.vercel-storage.com/progress-photos/uuid-front.jpg' });
    expect(blob.put).toHaveBeenCalled();
  });

  it('returns 400 when file is missing', async () => {
    const { POST } = await import('./progress-photos/upload/route');
    const formData = new FormData();
    formData.append('pose', 'back');

    const req = new NextRequest('http://localhost/api/progress-photos/upload', {
      method: 'POST',
      body: formData,
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'file is required' });
  });

  it('defaults pose to front when not provided', async () => {
    const blob = await import('@vercel/blob');
    vi.mocked(blob.put).mockResolvedValue({
      url: 'https://blob.vercel-storage.com/progress-photos/uuid-front.jpg',
    } as Awaited<ReturnType<typeof blob.put>>);

    const { POST } = await import('./progress-photos/upload/route');
    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('file', file);

    const req = new NextRequest('http://localhost/api/progress-photos/upload', {
      method: 'POST',
      body: formData,
    });
    await POST(req);

    const [[pathname]] = vi.mocked(blob.put).mock.calls;
    expect(pathname).toMatch(/front/);
  });
});
