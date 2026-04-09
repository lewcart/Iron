import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ===== Mock @/db/queries =====

vi.mock('@/db/queries', () => ({
  listInspoPhotos: vi.fn(),
  createInspoPhoto: vi.fn(),
  deleteInspoPhoto: vi.fn(),
}));

// ===== Mock @vercel/blob =====

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}));

// ===== Fixtures =====

const mockPhoto = {
  uuid: 'inspo-uuid-1',
  blob_url: 'https://blob.vercel-storage.com/inspo-photos/inspo-uuid-1.jpg',
  notes: null,
  taken_at: '2026-04-09T10:00:00.000Z',
  burst_group_id: null,
};

// ===== GET /api/inspo-photos =====

describe('GET /api/inspo-photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns inspo photos with default limit', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listInspoPhotos).mockResolvedValue([mockPhoto]);

    const { GET } = await import('./inspo-photos/route');
    const req = new NextRequest('http://localhost/api/inspo-photos');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockPhoto]);
    expect(queries.listInspoPhotos).toHaveBeenCalledWith(50);
  });

  it('passes custom limit param', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listInspoPhotos).mockResolvedValue([]);

    const { GET } = await import('./inspo-photos/route');
    const req = new NextRequest('http://localhost/api/inspo-photos?limit=20');
    await GET(req);

    expect(queries.listInspoPhotos).toHaveBeenCalledWith(20);
  });
});

// ===== POST /api/inspo-photos =====

describe('POST /api/inspo-photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and returns a new inspo photo', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createInspoPhoto).mockResolvedValue(mockPhoto);

    const { POST } = await import('./inspo-photos/route');
    const req = new NextRequest('http://localhost/api/inspo-photos', {
      method: 'POST',
      body: JSON.stringify({
        blob_url: 'https://blob.vercel-storage.com/inspo-photos/inspo-uuid-1.jpg',
        taken_at: '2026-04-09T10:00:00.000Z',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockPhoto);
    expect(queries.createInspoPhoto).toHaveBeenCalledWith({
      blob_url: 'https://blob.vercel-storage.com/inspo-photos/inspo-uuid-1.jpg',
      notes: null,
      taken_at: '2026-04-09T10:00:00.000Z',
      burst_group_id: null,
    });
  });

  it('returns 400 when blob_url is missing', async () => {
    const { POST } = await import('./inspo-photos/route');
    const req = new NextRequest('http://localhost/api/inspo-photos', {
      method: 'POST',
      body: JSON.stringify({ notes: 'some note' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'blob_url is required' });
  });

  it('passes null for missing optional fields', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createInspoPhoto).mockResolvedValue(mockPhoto);

    const { POST } = await import('./inspo-photos/route');
    const req = new NextRequest('http://localhost/api/inspo-photos', {
      method: 'POST',
      body: JSON.stringify({ blob_url: 'https://example.com/photo.jpg' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);

    expect(queries.createInspoPhoto).toHaveBeenCalledWith({
      blob_url: 'https://example.com/photo.jpg',
      notes: null,
      taken_at: undefined,
      burst_group_id: null,
    });
  });
});

// ===== DELETE /api/inspo-photos/[uuid] =====

describe('DELETE /api/inspo-photos/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes an inspo photo and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteInspoPhoto).mockResolvedValue(undefined);

    const { DELETE } = await import('./inspo-photos/[uuid]/route');
    const req = new NextRequest('http://localhost/api/inspo-photos/inspo-uuid-1', {
      method: 'DELETE',
    });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'inspo-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteInspoPhoto).toHaveBeenCalledWith('inspo-uuid-1');
  });
});

// ===== POST /api/inspo-photos/upload =====

describe('POST /api/inspo-photos/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads a file and returns the blob url', async () => {
    const blob = await import('@vercel/blob');
    vi.mocked(blob.put).mockResolvedValue({
      url: 'https://blob.vercel-storage.com/inspo-photos/uuid.jpg',
    } as Awaited<ReturnType<typeof blob.put>>);

    const { POST } = await import('./inspo-photos/upload/route');
    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('file', file);

    const req = new NextRequest('http://localhost/api/inspo-photos/upload', {
      method: 'POST',
      body: formData,
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ url: 'https://blob.vercel-storage.com/inspo-photos/uuid.jpg' });
    expect(blob.put).toHaveBeenCalled();
    const [[pathname]] = vi.mocked(blob.put).mock.calls;
    expect(pathname).toMatch(/^inspo-photos\//);
  });

  it('returns 400 when file is missing', async () => {
    const { POST } = await import('./inspo-photos/upload/route');
    const formData = new FormData();

    const req = new NextRequest('http://localhost/api/inspo-photos/upload', {
      method: 'POST',
      body: formData,
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'file is required' });
  });
});
