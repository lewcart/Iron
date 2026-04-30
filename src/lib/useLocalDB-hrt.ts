'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type { LocalHrtLog, LocalHrtProtocol } from '@/db/local';

// ─── HRT dose logs ───────────────────────────────────────────────────────────

export function useHrtLogs(limit = 30): LocalHrtLog[] {
  return useLiveQuery(
    async () => {
      const all = await db.hrt_logs.filter(l => !l._deleted).toArray();
      return all
        .sort((a, b) => b.logged_at.localeCompare(a.logged_at))
        .slice(0, limit);
    },
    [limit],
    [],
  );
}

// ─── HRT protocols ───────────────────────────────────────────────────────────

export function useHrtProtocols(): LocalHrtProtocol[] {
  return useLiveQuery(
    async () => {
      const all = await db.hrt_protocols.filter(p => !p._deleted).toArray();
      return all.sort((a, b) => b.started_at.localeCompare(a.started_at));
    },
    [],
    [],
  );
}

/** Active protocols are those with no ended_at. */
export function useActiveHrtProtocols(): LocalHrtProtocol[] {
  return useLiveQuery(
    async () => {
      const all = await db.hrt_protocols.filter(p => !p._deleted && !p.ended_at).toArray();
      return all.sort((a, b) => b.started_at.localeCompare(a.started_at));
    },
    [],
    [],
  );
}
