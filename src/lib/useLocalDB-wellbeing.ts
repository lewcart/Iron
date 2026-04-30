'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type {
  LocalWellbeingLog,
  LocalDysphoriaLog,
  LocalClothesTestLog,
} from '@/db/local';

// Reactive hooks for the three wellbeing tabs. Each returns
// most-recent-first, capped to a sensible UI window.

export function useWellbeingLogs(limit = 30): LocalWellbeingLog[] {
  return useLiveQuery(
    () =>
      db.wellbeing_logs
        .filter(l => !l._deleted)
        .reverse()
        .sortBy('logged_at')
        .then(rows => rows.slice(0, limit)),
    [limit],
    [],
  );
}

export function useDysphoriaLogs(limit = 60): LocalDysphoriaLog[] {
  return useLiveQuery(
    () =>
      db.dysphoria_logs
        .filter(l => !l._deleted)
        .reverse()
        .sortBy('logged_at')
        .then(rows => rows.slice(0, limit)),
    [limit],
    [],
  );
}

export function useClothesTestLogs(limit = 50): LocalClothesTestLog[] {
  return useLiveQuery(
    () =>
      db.clothes_test_logs
        .filter(l => !l._deleted)
        .reverse()
        .sortBy('logged_at')
        .then(rows => rows.slice(0, limit)),
    [limit],
    [],
  );
}
