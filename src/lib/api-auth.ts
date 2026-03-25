import { NextRequest, NextResponse } from 'next/server';

/**
 * Validates the REBIRTH_API_KEY for protected routes.
 *
 * Accepts the key via:
 *   Authorization: Bearer <key>
 *   X-Api-Key: <key>
 *
 * Returns a 401 NextResponse if auth fails, or null if the request is authorized.
 * If REBIRTH_API_KEY is not set in env, all requests are allowed (dev mode).
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  const apiKey = process.env.REBIRTH_API_KEY;
  if (!apiKey) return null; // No key configured — open access (local dev)

  const authHeader = request.headers.get('authorization');
  const provided =
    authHeader?.startsWith('Bearer ') ? authHeader.slice(7) :
    request.headers.get('x-api-key');

  if (provided !== apiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
