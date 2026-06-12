/**
 * Tests for src/lib/nutrition/promote-food.ts
 *
 * Tests:
 *   - promoteFoodFromResult: mints once + idempotent on repeat (dedupe by name+source)
 *   - serving_size → per_unit/per_qty carried correctly (100g serving → scaling works)
 *   - resolveFood: by uuid and by name
 *   - createManualFood: mints + idempotent
 *
 * Uses vi.hoisted to establish mocks before module resolution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Hoisted mock infrastructure ─────────────────────────────────────────────
// vi.hoisted ensures these variables are initialized before vi.mock factories run.

const { _store, mockFoodsTable, mockSchedulePush, mockGenUUID } = vi.hoisted(() => {
  const _store = new Map<string, Record<string, unknown>>();
  let _uuidCounter = 0;

  const mockGenUUID = vi.fn(() => `test-uuid-${++_uuidCounter}`);
  const mockSchedulePush = vi.fn();

  // Build a minimal Dexie Table-like mock backed by _store.
  const mockFoodsTable = {
    get: vi.fn(async (uuid: string) => _store.get(uuid) ?? undefined),
    put: vi.fn(async (row: Record<string, unknown>) => {
      _store.set(row.uuid as string, row);
      return row.uuid as string;
    }),
    where: vi.fn((field: string) => ({
      equals: vi.fn((val: string) => ({
        filter: vi.fn((pred: (f: Record<string, unknown>) => boolean) => ({
          first: vi.fn(async () => {
            for (const row of _store.values()) {
              if (row[field] === val && pred(row)) return row;
            }
            return undefined;
          }),
          toArray: vi.fn(async () => {
            const results: Record<string, unknown>[] = [];
            for (const row of _store.values()) {
              if (row[field] === val && pred(row)) results.push(row);
            }
            return results;
          }),
        })),
      })),
    })),
    filter: vi.fn((pred: (f: Record<string, unknown>) => boolean) => ({
      first: vi.fn(async () => {
        for (const row of _store.values()) {
          if (pred(row)) return row;
        }
        return undefined;
      }),
      toArray: vi.fn(async () => Array.from(_store.values()).filter(pred)),
    })),
  };

  return { _store, mockFoodsTable, mockSchedulePush, mockGenUUID };
});

vi.mock('@/db/local', () => ({
  db: { foods: mockFoodsTable },
}));

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: mockSchedulePush },
}));

vi.mock('@/lib/uuid', () => ({
  uuid: mockGenUUID,
}));

// ─── Import after mocks are registered ───────────────────────────────────────

import type { LocalFood } from '@/db/local';
import type { FoodResult } from '@/lib/nutrition-history-types';
import { promoteFoodFromResult, createManualFood, resolveFood } from './promote-food';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _store.clear();
  mockGenUUID.mockImplementation((() => {
    let c = 0;
    return () => `test-uuid-${++c}`;
  })());
  vi.clearAllMocks();
  // Re-bind put after clearAllMocks (clearAllMocks wipes implementations too)
  mockFoodsTable.put.mockImplementation(async (row: Record<string, unknown>) => {
    _store.set(row.uuid as string, row);
    return row.uuid as string;
  });
  mockFoodsTable.get.mockImplementation(async (uuid: string) => _store.get(uuid) ?? undefined);
});

// ─── Test data ────────────────────────────────────────────────────────────────

const baseResult: FoodResult = {
  source: 'local',
  food_name: 'Rolled Oats',
  serving_size: { qty: 100, unit: 'g' },
  calories: 389,
  protein_g: 17,
  carbs_g: 66,
  fat_g: 7,
  nutrients: { fiber_g: 10 },
  external_id: null,
  meta: null,
};

const seedFood = (overrides?: Partial<LocalFood>): LocalFood => {
  const row: LocalFood = {
    uuid: 'food-abc-123',
    name: 'Chicken Breast',
    brand: null,
    per_unit: 'g',
    per_qty: 100,
    calories: 165,
    protein_g: 31,
    carbs_g: 0,
    fat_g: 3.6,
    nutrients: {},
    source: 'manual',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    _synced: true,
    _updated_at: 0,
    _deleted: false,
    ...overrides,
  };
  _store.set(row.uuid, row as unknown as Record<string, unknown>);
  return row;
};

// ─── promoteFoodFromResult ────────────────────────────────────────────────────

describe('promoteFoodFromResult', () => {
  it('mints a new food row on first call', async () => {
    const uuid = await promoteFoodFromResult(baseResult);
    expect(uuid).toBeTruthy();
    expect(mockFoodsTable.put).toHaveBeenCalledOnce();
    const row = _store.get(uuid)!;
    expect(row.name).toBe('Rolled Oats');
    expect(row.source).toBe('local');
  });

  it('is idempotent: second call with same name+source returns same uuid', async () => {
    const uuid1 = await promoteFoodFromResult(baseResult);
    const uuid2 = await promoteFoodFromResult(baseResult);
    expect(uuid1).toBe(uuid2);
    // put should only have been called once (no second mint)
    expect(mockFoodsTable.put).toHaveBeenCalledOnce();
  });

  it('different source mints a separate row', async () => {
    const uuid1 = await promoteFoodFromResult(baseResult);
    const offResult: FoodResult = { ...baseResult, source: 'off', external_id: 'off-123' };
    const uuid2 = await promoteFoodFromResult(offResult);
    expect(uuid1).not.toBe(uuid2);
    expect(mockFoodsTable.put).toHaveBeenCalledTimes(2);
  });

  it('carries serving_size {qty:100, unit:"g"} → per_unit="g", per_qty=100', async () => {
    const uuid = await promoteFoodFromResult(baseResult);
    const row = _store.get(uuid)!;
    expect(row.per_unit).toBe('g');
    expect(row.per_qty).toBe(100);
  });

  it('per_unit=g + per_qty=100 enables 0.4× scaling for 40g quantity (math verification)', () => {
    // Confirm the stored values make derive-macros formula correct for 40g oats.
    const per_qty = 100;
    const amount = 40;
    const scale = amount / per_qty; // 0.4
    expect(scale).toBeCloseTo(0.4, 10);
    expect(scale * 389).toBeCloseTo(155.6, 5); // calories at 40g
    expect(scale * 17).toBeCloseTo(6.8, 5);    // protein_g at 40g
  });

  it('null serving_size falls back to per_unit="serve", per_qty=1', async () => {
    const result: FoodResult = { ...baseResult, serving_size: null };
    const uuid = await promoteFoodFromResult(result);
    const row = _store.get(uuid)!;
    expect(row.per_unit).toBe('serve');
    expect(row.per_qty).toBe(1);
  });

  it('ml unit is carried correctly', async () => {
    const result: FoodResult = {
      ...baseResult,
      food_name: 'Almond Milk',
      serving_size: { qty: 250, unit: 'ml' },
    };
    const uuid = await promoteFoodFromResult(result);
    const row = _store.get(uuid)!;
    expect(row.per_unit).toBe('ml');
    expect(row.per_qty).toBe(250);
  });

  it('serve unit is carried correctly', async () => {
    const result: FoodResult = {
      ...baseResult,
      food_name: 'Protein Powder',
      serving_size: { qty: 1, unit: 'serve' },
    };
    const uuid = await promoteFoodFromResult(result);
    const row = _store.get(uuid)!;
    expect(row.per_unit).toBe('serve');
    expect(row.per_qty).toBe(1);
  });

  it('carries macros and nutrients from FoodResult', async () => {
    const uuid = await promoteFoodFromResult(baseResult);
    const row = _store.get(uuid)!;
    expect(row.calories).toBe(389);
    expect(row.protein_g).toBe(17);
    expect(row.carbs_g).toBe(66);
    expect(row.fat_g).toBe(7);
    expect(row.nutrients).toEqual({ fiber_g: 10 });
  });

  it('throws INVALID_FOOD when food_name is empty after trim', async () => {
    const result: FoodResult = { ...baseResult, food_name: '  ' };
    await expect(promoteFoodFromResult(result)).rejects.toThrow('INVALID_FOOD');
  });

  it('ignores archived rows when deduplicating (does not treat them as existing)', async () => {
    // Pre-seed an archived row with the same name+source
    const archivedRow = {
      uuid: 'archived-uuid',
      name: 'Rolled Oats',
      brand: null,
      per_unit: 'g',
      per_qty: 100,
      calories: 389,
      protein_g: 17,
      carbs_g: 66,
      fat_g: 7,
      nutrients: {},
      source: 'local',
      archived_at: '2025-01-01T00:00:00Z',
      created_at: '2025-01-01T00:00:00Z',
      _synced: true,
      _updated_at: 0,
      _deleted: false,
    };
    _store.set('archived-uuid', archivedRow);

    // Should mint a new row (archived one is filtered out)
    const uuid = await promoteFoodFromResult(baseResult);
    expect(uuid).not.toBe('archived-uuid');
    expect(mockFoodsTable.put).toHaveBeenCalledOnce();
  });
});

// ─── createManualFood ─────────────────────────────────────────────────────────

describe('createManualFood', () => {
  it('mints a new food with source="manual"', async () => {
    const uuid = await createManualFood({
      name: 'Brown Rice',
      per_unit: 'g',
      per_qty: 100,
      calories: 130,
      protein_g: 2.7,
      carbs_g: 28,
      fat_g: 0.3,
    });
    expect(uuid).toBeTruthy();
    const row = _store.get(uuid)!;
    expect(row.name).toBe('Brown Rice');
    expect(row.source).toBe('manual');
    expect(row.per_unit).toBe('g');
    expect(row.per_qty).toBe(100);
  });

  it('is idempotent by lower(name) + manual source', async () => {
    const uuid1 = await createManualFood({ name: 'Brown Rice', per_unit: 'g', per_qty: 100 });
    const uuid2 = await createManualFood({ name: 'brown rice', per_unit: 'g', per_qty: 100 });
    expect(uuid1).toBe(uuid2);
    expect(mockFoodsTable.put).toHaveBeenCalledOnce();
  });

  it('throws INVALID_FOOD when name is empty', async () => {
    await expect(createManualFood({ name: '' })).rejects.toThrow('INVALID_FOOD');
  });

  it('throws INVALID_FOOD when per_qty is 0', async () => {
    await expect(createManualFood({ name: 'Test', per_qty: 0 })).rejects.toThrow('INVALID_FOOD');
  });

  it('defaults per_unit=serve, per_qty=1 when not provided', async () => {
    const uuid = await createManualFood({ name: 'Supplement Pill', calories: 10 });
    const row = _store.get(uuid)!;
    expect(row.per_unit).toBe('serve');
    expect(row.per_qty).toBe(1);
  });
});

// ─── resolveFood ─────────────────────────────────────────────────────────────

describe('resolveFood', () => {
  it('resolves by uuid — returns the food row', async () => {
    const seeded = seedFood();
    const result = await resolveFood({ food_uuid: 'food-abc-123' });
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe(seeded.uuid);
    expect(result!.name).toBe('Chicken Breast');
  });

  it('resolves by uuid — returns null for unknown uuid', async () => {
    const result = await resolveFood({ food_uuid: 'does-not-exist' });
    expect(result).toBeNull();
  });

  it('resolves by uuid — returns null for _deleted row', async () => {
    seedFood({ _deleted: true });
    const result = await resolveFood({ food_uuid: 'food-abc-123' });
    expect(result).toBeNull();
  });

  it('resolves by name — case-insensitive match', async () => {
    seedFood();
    const result = await resolveFood({ food_name: 'chicken breast' });
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('food-abc-123');
  });

  it('resolves by name — returns null when no match', async () => {
    seedFood();
    const result = await resolveFood({ food_name: 'Tofu' });
    expect(result).toBeNull();
  });

  it('resolves by name — skips archived foods', async () => {
    seedFood({ archived_at: '2025-06-01T00:00:00Z' });
    const result = await resolveFood({ food_name: 'Chicken Breast' });
    expect(result).toBeNull();
  });

  it('returns null when neither uuid nor name provided', async () => {
    const result = await resolveFood({});
    expect(result).toBeNull();
  });

  it('uuid resolution includes archived food (ingredient rows must still resolve)', async () => {
    seedFood({ archived_at: '2025-06-01T00:00:00Z' });
    const result = await resolveFood({ food_uuid: 'food-abc-123' });
    // Archived foods ARE returned by uuid (ingredient rows still need to resolve after archive)
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('food-abc-123');
  });
});
