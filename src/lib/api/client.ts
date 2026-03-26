import { rebirthJsonHeaders } from './headers';

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
  const res = await fetch(input, init);
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
