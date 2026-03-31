import { Capacitor } from '@capacitor/core';
import { rebirthJsonHeaders } from './headers';

/** Returns the API origin — empty string on web (same-origin), production URL on native. */
export function apiBase(): string {
  return Capacitor.isNativePlatform() ? 'https://iron-swart.vercel.app' : '';
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const url = typeof input === 'string' && input.startsWith('/') ? `${apiBase()}${input}` : input;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`HTTP ${res.status}`, res.status, text);
  }
  return res.json() as Promise<T>;
}

/** Same as fetchJson but merges Rebirth JSON headers (for protected routes). */
export async function fetchJsonAuthed<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(rebirthJsonHeaders());
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((v, k) => headers.set(k, v));
  }
  return fetchJson<T>(input, { ...init, headers });
}
