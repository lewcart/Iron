import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, hydrateExercises } from './local';

// ─── Regression test: "Unknown Exercise" root cause ──────────────────────────
//
// Pre-fix: the bundled exercise catalog was inserted into Dexie with
// whatever case the JSON file shipped. sync/pull and every lookup site
// lowercased UUIDs. Any mixed-case UUID slipping through hydrate produced
// a permanent miss until sync overwrote the row → "Unknown Exercise"
// flashed on the workout view.
//
// This test guards the hydrate-side normalization so regressions can't
// silently reintroduce the bug.

describe('hydrateExercises — bundled catalog UUID normalization', () => {
  beforeEach(async () => {
    // Wipe Dexie before each test so hydrate's "if count > 0, skip" logic
    // exercises the actual seed path.
    await db.exercises.clear();
    await db._meta.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lowercases UUIDs from the bundled catalog before insert', async () => {
    // Bundled catalog with deliberately mixed-case UUIDs (the exact bug).
    const bundled = [
      {
        uuid: 'F5C74593-13F3-4BF7-877A-223CCD9395C7', // upper
        everkinetic_id: 770757,
        title: 'Ab Wheel',
        alias: [],
        description: null,
        primary_muscles: [],
        secondary_muscles: [],
        equipment: [],
        steps: [],
        tips: [],
      },
      {
        uuid: 'AbCdEf12-3456-7890-aBcD-eF1234567890', // mixed
        everkinetic_id: 1,
        title: 'Bench Press',
        alias: [],
        description: null,
        primary_muscles: [],
        secondary_muscles: [],
        equipment: [],
        steps: [],
        tips: [],
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(bundled), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await hydrateExercises();

    const stored = await db.exercises.toArray();
    expect(stored).toHaveLength(2);

    const uuids = stored.map(e => e.uuid).sort();
    expect(uuids).toEqual([
      'abcdef12-3456-7890-abcd-ef1234567890',
      'f5c74593-13f3-4bf7-877a-223ccd9395c7',
    ]);

    // Every stored uuid must be its own lowercase form — exhaustive check
    // so any future field added to the seed pipeline still gets normalized.
    for (const ex of stored) {
      expect(ex.uuid).toBe(ex.uuid.toLowerCase());
    }
  });

  it('fills in default values for fields the bundled JSON omitted', async () => {
    // The bundled catalog file (~141KB, ~770 exercises) was generated before
    // is_custom / is_hidden / movement_pattern were schema fields. The
    // hydrate path must default them so Dexie strict-mode reads work.
    const bundled = [
      {
        uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        everkinetic_id: 999,
        title: 'Squat',
        alias: [],
        description: null,
        primary_muscles: ['legs'],
        secondary_muscles: [],
        equipment: [],
        steps: [],
        tips: [],
        // is_custom, is_hidden, movement_pattern intentionally absent
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(bundled), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await hydrateExercises();

    const stored = await db.exercises.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(stored).toBeDefined();
    expect(stored!.is_custom).toBe(false);
    expect(stored!.is_hidden).toBe(false);
    expect(stored!.movement_pattern).toBeNull();
  });

  it('skips re-hydration when Dexie is already populated', async () => {
    // Seed Dexie directly so hydrate sees count > 0 and bails before fetch.
    await db.exercises.put({
      uuid: 'preexisting',
      everkinetic_id: 1,
      title: 'Preexisting',
      alias: [],
      description: null,
      primary_muscles: [],
      secondary_muscles: [],
      equipment: [],
      steps: [],
      tips: [],
      is_custom: false,
      is_hidden: false,
      movement_pattern: null,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await hydrateExercises();

    expect(fetchSpy).not.toHaveBeenCalled();
    const count = await db.exercises.count();
    expect(count).toBe(1);
  });
});
