import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.mock factories must be hoist-safe — declare the mock create fn first.
const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

// Auth + env stubs.
vi.mock('@/lib/api-auth', () => ({
  requireApiKey: vi.fn().mockReturnValue(null),
}));

import { POST } from './route';
import { requireApiKey } from '@/lib/api-auth';

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/exercises/generate-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeOpenAiResponse(parsed: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(parsed) } }],
  };
}

describe('POST /api/exercises/generate-content', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    createMock.mockReset();
    vi.mocked(requireApiKey).mockReturnValue(null);
  });
  afterEach(() => {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  });

  // ─── auth + config ─────────────────────────────────────────────────────

  it('returns 401 when requireApiKey denies', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(requireApiKey).mockReturnValueOnce(denied as never);
    const res = await POST(makeRequest({ kind: 'steps', exercise: { title: 'X' } }) as never);
    expect(res.status).toBe(401);
  });

  it('returns 500 when OPENAI_API_KEY is not set on the server', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(makeRequest({ kind: 'steps', exercise: { title: 'X' } }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('OPENAI_API_KEY');
  });

  // ─── body validation ───────────────────────────────────────────────────

  it('returns 400 on invalid body shape (missing kind)', async () => {
    const res = await POST(makeRequest({ exercise: { title: 'X' } }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid kind', async () => {
    const res = await POST(makeRequest({ kind: 'banana', exercise: { title: 'X' } }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing exercise.title', async () => {
    const res = await POST(makeRequest({ kind: 'steps', exercise: {} }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when kind='all' is sent with a uuid (draft-only contract)", async () => {
    const res = await POST(
      makeRequest({
        kind: 'all',
        exercise: { uuid: 'abc-123', title: 'X', primary_muscles: ['chest'] },
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("kind='all'");
  });

  // ─── happy path ────────────────────────────────────────────────────────

  it("kind='steps' returns 200 with valid steps array", async () => {
    createMock.mockResolvedValueOnce(
      makeOpenAiResponse({
        steps: ['Plant feet shoulder-width.', 'Hinge at the hips.', 'Drive hips forward.'],
      }),
    );
    const res = await POST(
      makeRequest({
        kind: 'steps',
        exercise: { title: 'Romanian Deadlift', primary_muscles: ['hamstrings'] },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps).toHaveLength(3);
  });

  it("kind='all' returns 200 with description + steps + tips", async () => {
    createMock.mockResolvedValueOnce(
      makeOpenAiResponse({
        description: 'A hip-hinge exercise loading the posterior chain.',
        steps: ['Plant feet.', 'Hinge.', 'Drive hips.'],
        tips: ["Don't round.", 'Stay close.'],
      }),
    );
    const res = await POST(
      makeRequest({
        kind: 'all',
        exercise: { title: 'Romanian Deadlift', primary_muscles: ['hamstrings'] },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.description).toMatch(/hip-hinge/);
    expect(body.steps).toHaveLength(3);
    expect(body.tips).toHaveLength(2);
  });

  it('passes an AbortSignal into the OpenAI call', async () => {
    createMock.mockResolvedValueOnce(makeOpenAiResponse({ steps: ['a.', 'b.', 'c.'] }));
    await POST(
      makeRequest({ kind: 'steps', exercise: { title: 'X', primary_muscles: ['chest'] } }) as never,
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    const [, opts] = createMock.mock.calls[0];
    expect(opts).toHaveProperty('signal');
    // Should be an AbortSignal-shaped object (combined via AbortSignal.any).
    expect(opts.signal).toBeDefined();
    expect(typeof opts.signal.aborted).toBe('boolean');
  });

  // ─── error paths ───────────────────────────────────────────────────────

  it('returns 502 when OpenAI throws a non-abort error', async () => {
    createMock.mockRejectedValueOnce(new Error('upstream blew up'));
    const res = await POST(
      makeRequest({ kind: 'steps', exercise: { title: 'X', primary_muscles: ['chest'] } }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('upstream blew up');
  });

  it('returns 504 when the OpenAI call aborts (cancel or timeout)', async () => {
    const abortErr: Error & { name: string } = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    createMock.mockRejectedValueOnce(abortErr);
    const res = await POST(
      makeRequest({ kind: 'steps', exercise: { title: 'X', primary_muscles: ['chest'] } }) as never,
    );
    expect(res.status).toBe(504);
  });

  // ─── post-parse validation (defense beyond strict mode) ────────────────

  it("returns 502 when output violates the schema (e.g. tips below minItems)", async () => {
    createMock.mockResolvedValueOnce(makeOpenAiResponse({ tips: ['only one'] }));
    const res = await POST(
      makeRequest({ kind: 'tips', exercise: { title: 'X', primary_muscles: ['chest'] } }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('schema-violating');
  });

  it("returns 502 when description is missing entirely from kind='description' output", async () => {
    createMock.mockResolvedValueOnce(makeOpenAiResponse({ wrong: 'shape' }));
    const res = await POST(
      makeRequest({
        kind: 'description',
        exercise: { title: 'X', primary_muscles: ['chest'] },
      }) as never,
    );
    expect(res.status).toBe(502);
  });

  it("returns 502 when a steps item exceeds the per-item maxLength", async () => {
    const longStep = 'x'.repeat(121);
    createMock.mockResolvedValueOnce(
      makeOpenAiResponse({ steps: [longStep, 'b.', 'c.'] }),
    );
    const res = await POST(
      makeRequest({ kind: 'steps', exercise: { title: 'X', primary_muscles: ['chest'] } }) as never,
    );
    expect(res.status).toBe(502);
  });
});
