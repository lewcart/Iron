'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type {
  LocalHrtTimelinePeriod,
  LocalLabDraw,
  LocalLabResult,
} from '@/db/local';

function now() { return Date.now(); }
function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── HRT timeline periods ────────────────────────────────────────────────────

export async function createHrtTimelinePeriod(opts: {
  name: string;
  started_at: string;             // YYYY-MM-DD
  ended_at?: string | null;
  doses_e?: string | null;
  doses_t_blocker?: string | null;
  doses_other?: string[];
  notes?: string | null;
}): Promise<LocalHrtTimelinePeriod> {
  const period: LocalHrtTimelinePeriod = {
    uuid: genUUID(),
    name: opts.name.trim(),
    started_at: opts.started_at,
    ended_at: opts.ended_at ?? null,
    doses_e: opts.doses_e ?? null,
    doses_t_blocker: opts.doses_t_blocker ?? null,
    doses_other: opts.doses_other ?? [],
    notes: opts.notes?.trim() || null,
    ...syncMeta(),
  };
  await db.hrt_timeline_periods.add(period);
  syncEngine.schedulePush();
  return period;
}

export async function updateHrtTimelinePeriod(
  uuid: string,
  patch: Partial<Omit<LocalHrtTimelinePeriod, 'uuid' | '_synced' | '_updated_at' | '_deleted'>>,
): Promise<void> {
  await db.hrt_timeline_periods.update(uuid, { ...patch, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function endHrtTimelinePeriod(uuid: string, endedAt?: string): Promise<void> {
  await db.hrt_timeline_periods.update(uuid, {
    ended_at: endedAt ?? new Date().toISOString().slice(0, 10),
    ...syncMeta(),
  });
  syncEngine.schedulePush();
}

export async function deleteHrtTimelinePeriod(uuid: string): Promise<void> {
  await db.hrt_timeline_periods.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Lab draws + results ─────────────────────────────────────────────────────

export async function createLabDraw(opts: {
  drawn_at: string;               // YYYY-MM-DD
  notes?: string | null;
  source?: string;
  results?: Array<{ lab_code: string; value: number }>;
}): Promise<LocalLabDraw> {
  const draw: LocalLabDraw = {
    uuid: genUUID(),
    drawn_at: opts.drawn_at,
    notes: opts.notes?.trim() || null,
    source: opts.source ?? 'manual',
    ...syncMeta(),
  };
  await db.lab_draws.add(draw);

  if (opts.results && opts.results.length > 0) {
    const rows: LocalLabResult[] = opts.results.map(r => ({
      uuid: genUUID(),
      draw_uuid: draw.uuid,
      lab_code: r.lab_code,
      value: r.value,
      ...syncMeta(),
    }));
    await db.lab_results.bulkAdd(rows);
  }

  syncEngine.schedulePush();
  return draw;
}

export async function updateLabDraw(
  uuid: string,
  patch: Partial<Pick<LocalLabDraw, 'drawn_at' | 'notes' | 'source'>>,
): Promise<void> {
  await db.lab_draws.update(uuid, { ...patch, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function deleteLabDraw(uuid: string): Promise<void> {
  // Soft-delete the draw + every result that referenced it. The server-side
  // CASCADE handles the FK relationship after both rows push, but we have to
  // tombstone children locally too so they push as deletes (not orphans).
  const results = await db.lab_results.filter(r => r.draw_uuid === uuid).toArray();
  await db.transaction('rw', db.lab_draws, db.lab_results, async () => {
    await db.lab_draws.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
    for (const r of results) {
      await db.lab_results.update(r.uuid, { _deleted: true, _synced: false, _updated_at: now() });
    }
  });
  syncEngine.schedulePush();
}

export async function upsertLabResult(opts: {
  draw_uuid: string;
  lab_code: string;
  value: number;
}): Promise<void> {
  const existing = await db.lab_results
    .filter(r => !r._deleted && r.draw_uuid === opts.draw_uuid && r.lab_code === opts.lab_code)
    .first();

  if (existing) {
    await db.lab_results.update(existing.uuid, { value: opts.value, ...syncMeta() });
  } else {
    await db.lab_results.add({
      uuid: genUUID(),
      draw_uuid: opts.draw_uuid,
      lab_code: opts.lab_code,
      value: opts.value,
      ...syncMeta(),
    });
  }
  syncEngine.schedulePush();
}

export async function deleteLabResult(uuid: string): Promise<void> {
  await db.lab_results.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}
