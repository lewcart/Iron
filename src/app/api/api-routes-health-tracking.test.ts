import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ===== Mock @/db/queries =====

vi.mock('@/db/queries', () => ({
  listBodySpecLogs: vi.fn(),
  createBodySpecLog: vi.fn(),
  getBodySpecLog: vi.fn(),
  updateBodySpecLog: vi.fn(),
  deleteBodySpecLog: vi.fn(),
  listHrtLogs: vi.fn(),
  createHrtLog: vi.fn(),
  getHrtLog: vi.fn(),
  updateHrtLog: vi.fn(),
  deleteHrtLog: vi.fn(),
  getMeasurementLog: vi.fn(),
  updateMeasurementLog: vi.fn(),
  deleteMeasurementLog: vi.fn(),
  listDysphoriaLogs: vi.fn(),
  createDysphoriaLog: vi.fn(),
  getDysphoriaLog: vi.fn(),
  updateDysphoriaLog: vi.fn(),
  deleteDysphoriaLog: vi.fn(),
  listClothesTestLogs: vi.fn(),
  createClothesTestLog: vi.fn(),
  getClothesTestLog: vi.fn(),
  updateClothesTestLog: vi.fn(),
  deleteClothesTestLog: vi.fn(),
}));

// ===== Fixtures =====

const mockBodySpecLog = {
  uuid: 'bs-uuid-1',
  measured_at: '2026-03-20T09:00:00.000Z',
  height_cm: 175.0,
  weight_kg: 80.5,
  body_fat_pct: 18.2,
  lean_mass_kg: 65.9,
  notes: null,
};

const mockHrtLog = {
  uuid: 'hrt-uuid-1',
  logged_at: '2026-03-20T08:00:00.000Z',
  medication: 'Testosterone Cypionate',
  dose_mg: 100.0,
  route: 'IM',
  notes: null,
};

const mockMeasurementLog = {
  uuid: 'msr-uuid-1',
  measured_at: '2026-03-20T09:00:00.000Z',
  waist_cm: 82.0,
  hips_cm: 95.0,
  chest_cm: 100.0,
  notes: null,
};

// ===== GET /api/body-spec =====

describe('GET /api/body-spec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns body spec logs with default limit', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listBodySpecLogs).mockResolvedValue([mockBodySpecLog]);

    const { GET } = await import('./body-spec/route');
    const req = new NextRequest('http://localhost/api/body-spec');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockBodySpecLog]);
    expect(queries.listBodySpecLogs).toHaveBeenCalledWith(90);
  });

  it('passes custom limit param', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listBodySpecLogs).mockResolvedValue([]);

    const { GET } = await import('./body-spec/route');
    const req = new NextRequest('http://localhost/api/body-spec?limit=30');
    await GET(req);

    expect(queries.listBodySpecLogs).toHaveBeenCalledWith(30);
  });
});

// ===== POST /api/body-spec =====

describe('POST /api/body-spec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and returns a new body spec log', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createBodySpecLog).mockResolvedValue(mockBodySpecLog);

    const { POST } = await import('./body-spec/route');
    const req = new NextRequest('http://localhost/api/body-spec', {
      method: 'POST',
      body: JSON.stringify({
        measured_at: '2026-03-20T09:00:00.000Z',
        height_cm: '175.0',
        weight_kg: '80.5',
        body_fat_pct: '18.2',
        lean_mass_kg: '65.9',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockBodySpecLog);
    expect(queries.createBodySpecLog).toHaveBeenCalledWith({
      height_cm: 175.0,
      weight_kg: 80.5,
      body_fat_pct: 18.2,
      lean_mass_kg: 65.9,
      notes: null,
      measured_at: '2026-03-20T09:00:00.000Z',
    });
  });

  it('passes null for missing numeric fields', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createBodySpecLog).mockResolvedValue(mockBodySpecLog);

    const { POST } = await import('./body-spec/route');
    const req = new NextRequest('http://localhost/api/body-spec', {
      method: 'POST',
      body: JSON.stringify({ measured_at: '2026-03-20T09:00:00.000Z' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);

    expect(queries.createBodySpecLog).toHaveBeenCalledWith({
      height_cm: null,
      weight_kg: null,
      body_fat_pct: null,
      lean_mass_kg: null,
      notes: null,
      measured_at: '2026-03-20T09:00:00.000Z',
    });
  });
});

// ===== GET /api/body-spec/[uuid] =====

describe('GET /api/body-spec/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a body spec log by uuid', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getBodySpecLog).mockResolvedValue(mockBodySpecLog);

    const { GET } = await import('./body-spec/[uuid]/route');
    const req = new NextRequest('http://localhost/api/body-spec/bs-uuid-1');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'bs-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockBodySpecLog);
    expect(queries.getBodySpecLog).toHaveBeenCalledWith('bs-uuid-1');
  });

  it('returns 404 when body spec log not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getBodySpecLog).mockResolvedValue(null);

    const { GET } = await import('./body-spec/[uuid]/route');
    const req = new NextRequest('http://localhost/api/body-spec/missing-uuid');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== PATCH /api/body-spec/[uuid] =====

describe('PATCH /api/body-spec/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates and returns a body spec log', async () => {
    const queries = await import('@/db/queries');
    const updated = { ...mockBodySpecLog, weight_kg: 79.0 };
    vi.mocked(queries.updateBodySpecLog).mockResolvedValue(updated);

    const { PATCH } = await import('./body-spec/[uuid]/route');
    const req = new NextRequest('http://localhost/api/body-spec/bs-uuid-1', {
      method: 'PATCH',
      body: JSON.stringify({ weight_kg: 79.0 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'bs-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(updated);
    expect(queries.updateBodySpecLog).toHaveBeenCalledWith('bs-uuid-1', { weight_kg: 79.0 });
  });

  it('returns 404 when body spec log not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.updateBodySpecLog).mockResolvedValue(null);

    const { PATCH } = await import('./body-spec/[uuid]/route');
    const req = new NextRequest('http://localhost/api/body-spec/missing-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ weight_kg: 79.0 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== DELETE /api/body-spec/[uuid] =====

describe('DELETE /api/body-spec/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a body spec log and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteBodySpecLog).mockResolvedValue(undefined);

    const { DELETE } = await import('./body-spec/[uuid]/route');
    const req = new NextRequest('http://localhost/api/body-spec/bs-uuid-1', { method: 'DELETE' });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'bs-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteBodySpecLog).toHaveBeenCalledWith('bs-uuid-1');
  });
});

// ===== GET /api/hrt =====

describe('GET /api/hrt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HRT logs with default limit', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listHrtLogs).mockResolvedValue([mockHrtLog]);

    const { GET } = await import('./hrt/route');
    const req = new NextRequest('http://localhost/api/hrt');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockHrtLog]);
    expect(queries.listHrtLogs).toHaveBeenCalledWith(90);
  });

  it('passes custom limit param', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listHrtLogs).mockResolvedValue([]);

    const { GET } = await import('./hrt/route');
    const req = new NextRequest('http://localhost/api/hrt?limit=14');
    await GET(req);

    expect(queries.listHrtLogs).toHaveBeenCalledWith(14);
  });
});

// ===== POST /api/hrt =====

describe('POST /api/hrt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and returns a new HRT log', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createHrtLog).mockResolvedValue(mockHrtLog);

    const { POST } = await import('./hrt/route');
    const req = new NextRequest('http://localhost/api/hrt', {
      method: 'POST',
      body: JSON.stringify({
        logged_at: '2026-03-20T08:00:00.000Z',
        medication: 'Testosterone Cypionate',
        dose_mg: '100.0',
        route: 'IM',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockHrtLog);
    expect(queries.createHrtLog).toHaveBeenCalledWith({
      logged_at: '2026-03-20T08:00:00.000Z',
      medication: 'Testosterone Cypionate',
      dose_mg: 100.0,
      route: 'IM',
      notes: null,
    });
  });

  it('returns 400 when medication is missing', async () => {
    const { POST } = await import('./hrt/route');
    const req = new NextRequest('http://localhost/api/hrt', {
      method: 'POST',
      body: JSON.stringify({ logged_at: '2026-03-20T08:00:00.000Z', dose_mg: 100 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'medication is required' });
  });

  it('passes null for missing optional fields', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createHrtLog).mockResolvedValue(mockHrtLog);

    const { POST } = await import('./hrt/route');
    const req = new NextRequest('http://localhost/api/hrt', {
      method: 'POST',
      body: JSON.stringify({ logged_at: '2026-03-20T08:00:00.000Z', medication: 'Estradiol' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);

    expect(queries.createHrtLog).toHaveBeenCalledWith({
      logged_at: '2026-03-20T08:00:00.000Z',
      medication: 'Estradiol',
      dose_mg: null,
      route: null,
      notes: null,
    });
  });
});

// ===== GET /api/hrt/[uuid] =====

describe('GET /api/hrt/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an HRT log by uuid', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getHrtLog).mockResolvedValue(mockHrtLog);

    const { GET } = await import('./hrt/[uuid]/route');
    const req = new NextRequest('http://localhost/api/hrt/hrt-uuid-1');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'hrt-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockHrtLog);
    expect(queries.getHrtLog).toHaveBeenCalledWith('hrt-uuid-1');
  });

  it('returns 404 when HRT log not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getHrtLog).mockResolvedValue(null);

    const { GET } = await import('./hrt/[uuid]/route');
    const req = new NextRequest('http://localhost/api/hrt/missing-uuid');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== PATCH /api/hrt/[uuid] =====

describe('PATCH /api/hrt/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates and returns an HRT log', async () => {
    const queries = await import('@/db/queries');
    const updated = { ...mockHrtLog, dose_mg: 80.0 };
    vi.mocked(queries.updateHrtLog).mockResolvedValue(updated);

    const { PATCH } = await import('./hrt/[uuid]/route');
    const req = new NextRequest('http://localhost/api/hrt/hrt-uuid-1', {
      method: 'PATCH',
      body: JSON.stringify({ dose_mg: 80.0 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'hrt-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(updated);
    expect(queries.updateHrtLog).toHaveBeenCalledWith('hrt-uuid-1', { dose_mg: 80.0 });
  });

  it('returns 404 when HRT log not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.updateHrtLog).mockResolvedValue(null);

    const { PATCH } = await import('./hrt/[uuid]/route');
    const req = new NextRequest('http://localhost/api/hrt/missing-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ dose_mg: 80.0 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== DELETE /api/hrt/[uuid] =====

describe('DELETE /api/hrt/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes an HRT log and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteHrtLog).mockResolvedValue(undefined);

    const { DELETE } = await import('./hrt/[uuid]/route');
    const req = new NextRequest('http://localhost/api/hrt/hrt-uuid-1', { method: 'DELETE' });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'hrt-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteHrtLog).toHaveBeenCalledWith('hrt-uuid-1');
  });
});

// ===== GET /api/measurements/[uuid] =====

describe('GET /api/measurements/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a measurement log by uuid', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getMeasurementLog).mockResolvedValue(mockMeasurementLog);

    const { GET } = await import('./measurements/[uuid]/route');
    const req = new NextRequest('http://localhost/api/measurements/msr-uuid-1');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'msr-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockMeasurementLog);
    expect(queries.getMeasurementLog).toHaveBeenCalledWith('msr-uuid-1');
  });

  it('returns 404 when measurement log not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getMeasurementLog).mockResolvedValue(null);

    const { GET } = await import('./measurements/[uuid]/route');
    const req = new NextRequest('http://localhost/api/measurements/missing-uuid');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== PATCH /api/measurements/[uuid] =====

describe('PATCH /api/measurements/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates and returns a measurement log', async () => {
    const queries = await import('@/db/queries');
    const updated = { ...mockMeasurementLog, waist_cm: 80.0 };
    vi.mocked(queries.updateMeasurementLog).mockResolvedValue(updated);

    const { PATCH } = await import('./measurements/[uuid]/route');
    const req = new NextRequest('http://localhost/api/measurements/msr-uuid-1', {
      method: 'PATCH',
      body: JSON.stringify({ waist_cm: 80.0 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'msr-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(updated);
    expect(queries.updateMeasurementLog).toHaveBeenCalledWith('msr-uuid-1', { waist_cm: 80.0 });
  });

  it('returns 404 when measurement log not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.updateMeasurementLog).mockResolvedValue(null);

    const { PATCH } = await import('./measurements/[uuid]/route');
    const req = new NextRequest('http://localhost/api/measurements/missing-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ waist_cm: 80.0 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== DELETE /api/measurements/[uuid] =====

describe('DELETE /api/measurements/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a measurement log and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteMeasurementLog).mockResolvedValue(undefined);

    const { DELETE } = await import('./measurements/[uuid]/route');
    const req = new NextRequest('http://localhost/api/measurements/msr-uuid-1', { method: 'DELETE' });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'msr-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteMeasurementLog).toHaveBeenCalledWith('msr-uuid-1');
  });
});

// ===== Dysphoria fixtures =====

const mockDysphoriaLog = {
  uuid: 'dys-uuid-1',
  logged_at: '2026-03-20T09:00:00.000Z',
  scale: 7,
  note: 'Feeling pretty good today',
};

// ===== GET /api/dysphoria =====

describe('GET /api/dysphoria', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns dysphoria logs with default limit', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listDysphoriaLogs).mockResolvedValue([mockDysphoriaLog]);

    const { GET } = await import('./dysphoria/route');
    const req = new NextRequest('http://localhost/api/dysphoria');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockDysphoriaLog]);
    expect(queries.listDysphoriaLogs).toHaveBeenCalledWith(90);
  });

  it('passes custom limit param', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listDysphoriaLogs).mockResolvedValue([]);

    const { GET } = await import('./dysphoria/route');
    const req = new NextRequest('http://localhost/api/dysphoria?limit=14');
    await GET(req);

    expect(queries.listDysphoriaLogs).toHaveBeenCalledWith(14);
  });
});

// ===== POST /api/dysphoria =====

describe('POST /api/dysphoria', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates and returns a new dysphoria log', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createDysphoriaLog).mockResolvedValue(mockDysphoriaLog);

    const { POST } = await import('./dysphoria/route');
    const req = new NextRequest('http://localhost/api/dysphoria', {
      method: 'POST',
      body: JSON.stringify({ scale: '7', note: 'Feeling pretty good today' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockDysphoriaLog);
    expect(queries.createDysphoriaLog).toHaveBeenCalledWith({
      scale: 7,
      note: 'Feeling pretty good today',
      logged_at: undefined,
    });
  });

  it('returns 400 when scale is missing', async () => {
    const { POST } = await import('./dysphoria/route');
    const req = new NextRequest('http://localhost/api/dysphoria', {
      method: 'POST',
      body: JSON.stringify({ note: 'no scale' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'scale is required' });
  });
});

// ===== GET /api/dysphoria/[uuid] =====

describe('GET /api/dysphoria/[uuid]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns a dysphoria log by uuid', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getDysphoriaLog).mockResolvedValue(mockDysphoriaLog);

    const { GET } = await import('./dysphoria/[uuid]/route');
    const req = new NextRequest('http://localhost/api/dysphoria/dys-uuid-1');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'dys-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockDysphoriaLog);
    expect(queries.getDysphoriaLog).toHaveBeenCalledWith('dys-uuid-1');
  });

  it('returns 404 when not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getDysphoriaLog).mockResolvedValue(null);

    const { GET } = await import('./dysphoria/[uuid]/route');
    const req = new NextRequest('http://localhost/api/dysphoria/missing');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'missing' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== PATCH /api/dysphoria/[uuid] =====

describe('PATCH /api/dysphoria/[uuid]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates and returns a dysphoria log', async () => {
    const queries = await import('@/db/queries');
    const updated = { ...mockDysphoriaLog, scale: 9 };
    vi.mocked(queries.updateDysphoriaLog).mockResolvedValue(updated);

    const { PATCH } = await import('./dysphoria/[uuid]/route');
    const req = new NextRequest('http://localhost/api/dysphoria/dys-uuid-1', {
      method: 'PATCH',
      body: JSON.stringify({ scale: 9 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'dys-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(updated);
    expect(queries.updateDysphoriaLog).toHaveBeenCalledWith('dys-uuid-1', { scale: 9 });
  });

  it('returns 404 when not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.updateDysphoriaLog).mockResolvedValue(null);

    const { PATCH } = await import('./dysphoria/[uuid]/route');
    const req = new NextRequest('http://localhost/api/dysphoria/missing', {
      method: 'PATCH',
      body: JSON.stringify({ scale: 9 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'missing' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== DELETE /api/dysphoria/[uuid] =====

describe('DELETE /api/dysphoria/[uuid]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes a dysphoria log and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteDysphoriaLog).mockResolvedValue(undefined);

    const { DELETE } = await import('./dysphoria/[uuid]/route');
    const req = new NextRequest('http://localhost/api/dysphoria/dys-uuid-1', { method: 'DELETE' });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'dys-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteDysphoriaLog).toHaveBeenCalledWith('dys-uuid-1');
  });
});

// ===== Clothes test fixtures =====

const mockClothesTestLog = {
  uuid: 'ct-uuid-1',
  logged_at: '2026-03-20T09:00:00.000Z',
  outfit_description: 'Floral sundress',
  photo_url: null,
  comfort_rating: 8,
  euphoria_rating: 9,
  notes: null,
};

// ===== GET /api/clothes-test =====

describe('GET /api/clothes-test', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns clothes test logs with default limit', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listClothesTestLogs).mockResolvedValue([mockClothesTestLog]);

    const { GET } = await import('./clothes-test/route');
    const req = new NextRequest('http://localhost/api/clothes-test');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockClothesTestLog]);
    expect(queries.listClothesTestLogs).toHaveBeenCalledWith(50);
  });
});

// ===== POST /api/clothes-test =====

describe('POST /api/clothes-test', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates and returns a new clothes test log', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createClothesTestLog).mockResolvedValue(mockClothesTestLog);

    const { POST } = await import('./clothes-test/route');
    const req = new NextRequest('http://localhost/api/clothes-test', {
      method: 'POST',
      body: JSON.stringify({
        outfit_description: 'Floral sundress',
        comfort_rating: '8',
        euphoria_rating: '9',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockClothesTestLog);
    expect(queries.createClothesTestLog).toHaveBeenCalledWith({
      logged_at: undefined,
      outfit_description: 'Floral sundress',
      photo_url: null,
      comfort_rating: 8,
      euphoria_rating: 9,
      notes: null,
    });
  });

  it('returns 400 when outfit_description is missing', async () => {
    const { POST } = await import('./clothes-test/route');
    const req = new NextRequest('http://localhost/api/clothes-test', {
      method: 'POST',
      body: JSON.stringify({ comfort_rating: 8 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'outfit_description is required' });
  });
});

// ===== GET /api/clothes-test/[uuid] =====

describe('GET /api/clothes-test/[uuid]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns a clothes test log by uuid', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getClothesTestLog).mockResolvedValue(mockClothesTestLog);

    const { GET } = await import('./clothes-test/[uuid]/route');
    const req = new NextRequest('http://localhost/api/clothes-test/ct-uuid-1');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'ct-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockClothesTestLog);
    expect(queries.getClothesTestLog).toHaveBeenCalledWith('ct-uuid-1');
  });

  it('returns 404 when not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getClothesTestLog).mockResolvedValue(null);

    const { GET } = await import('./clothes-test/[uuid]/route');
    const req = new NextRequest('http://localhost/api/clothes-test/missing');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'missing' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== PATCH /api/clothes-test/[uuid] =====

describe('PATCH /api/clothes-test/[uuid]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates and returns a clothes test log', async () => {
    const queries = await import('@/db/queries');
    const updated = { ...mockClothesTestLog, euphoria_rating: 10 };
    vi.mocked(queries.updateClothesTestLog).mockResolvedValue(updated);

    const { PATCH } = await import('./clothes-test/[uuid]/route');
    const req = new NextRequest('http://localhost/api/clothes-test/ct-uuid-1', {
      method: 'PATCH',
      body: JSON.stringify({ euphoria_rating: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'ct-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(updated);
    expect(queries.updateClothesTestLog).toHaveBeenCalledWith('ct-uuid-1', { euphoria_rating: 10 });
  });

  it('returns 404 when not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.updateClothesTestLog).mockResolvedValue(null);

    const { PATCH } = await import('./clothes-test/[uuid]/route');
    const req = new NextRequest('http://localhost/api/clothes-test/missing', {
      method: 'PATCH',
      body: JSON.stringify({ euphoria_rating: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'missing' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });
});

// ===== DELETE /api/clothes-test/[uuid] =====

describe('DELETE /api/clothes-test/[uuid]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes a clothes test log and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteClothesTestLog).mockResolvedValue(undefined);

    const { DELETE } = await import('./clothes-test/[uuid]/route');
    const req = new NextRequest('http://localhost/api/clothes-test/ct-uuid-1', { method: 'DELETE' });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'ct-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteClothesTestLog).toHaveBeenCalledWith('ct-uuid-1');
  });
});
