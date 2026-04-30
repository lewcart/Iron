import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/db/local';
import {
  logWellbeing,
  deleteWellbeingLog,
  logDysphoria,
  deleteDysphoriaLog,
  logClothesTest,
  deleteClothesTestLog,
} from './mutations-wellbeing';

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

describe('mutations-wellbeing', () => {
  beforeEach(async () => {
    await Promise.all([
      db.wellbeing_logs.clear(),
      db.dysphoria_logs.clear(),
      db.clothes_test_logs.clear(),
    ]);
  });

  describe('wellbeing logs', () => {
    it('logWellbeing inserts with sync metadata + trims notes + sets logged_at', async () => {
      const log = await logWellbeing({
        mood: 4,
        energy: 3,
        sleep_hours: 7.5,
        notes: '  good day  ',
      });

      const stored = await db.wellbeing_logs.get(log.uuid);
      expect(stored).toBeDefined();
      expect(stored!.mood).toBe(4);
      expect(stored!.energy).toBe(3);
      expect(stored!.sleep_hours).toBe(7.5);
      expect(stored!.notes).toBe('good day');
      expect(stored!._synced).toBe(false);
      expect(stored!._deleted).toBe(false);
      expect(stored!.logged_at).toBeTruthy();
    });

    it('logWellbeing normalizes empty/whitespace notes to null', async () => {
      const log = await logWellbeing({ mood: 4, notes: '   ' });
      const stored = await db.wellbeing_logs.get(log.uuid);
      expect(stored!.notes).toBeNull();
    });

    it('deleteWellbeingLog soft-deletes for sync', async () => {
      const log = await logWellbeing({ mood: 5 });
      await deleteWellbeingLog(log.uuid);
      const stored = await db.wellbeing_logs.get(log.uuid);
      expect(stored!._deleted).toBe(true);
      expect(stored!._synced).toBe(false);
    });
  });

  describe('dysphoria logs', () => {
    it('logDysphoria persists scale + trimmed note', async () => {
      const log = await logDysphoria({ scale: 7, note: '  felt good  ' });
      const stored = await db.dysphoria_logs.get(log.uuid);
      expect(stored!.scale).toBe(7);
      expect(stored!.note).toBe('felt good');
    });

    it('deleteDysphoriaLog soft-deletes', async () => {
      const log = await logDysphoria({ scale: 5 });
      await deleteDysphoriaLog(log.uuid);
      const stored = await db.dysphoria_logs.get(log.uuid);
      expect(stored!._deleted).toBe(true);
    });
  });

  describe('clothes test logs', () => {
    it('logClothesTest persists outfit + ratings + notes', async () => {
      const log = await logClothesTest({
        outfit_description: '  black dress  ',
        comfort_rating: 8,
        euphoria_rating: 9,
        notes: 'felt amazing',
      });
      const stored = await db.clothes_test_logs.get(log.uuid);
      expect(stored!.outfit_description).toBe('black dress');
      expect(stored!.comfort_rating).toBe(8);
      expect(stored!.euphoria_rating).toBe(9);
      expect(stored!.notes).toBe('felt amazing');
    });

    it('deleteClothesTestLog soft-deletes', async () => {
      const log = await logClothesTest({ outfit_description: 'jeans' });
      await deleteClothesTestLog(log.uuid);
      const stored = await db.clothes_test_logs.get(log.uuid);
      expect(stored!._deleted).toBe(true);
    });
  });
});
