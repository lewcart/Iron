import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/db/local';
import { ensurePlannedLogsForDate, setWeekMeal } from './mutations-nutrition';

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

// dateToDayOfWeek('2026-05-04'): Monday → 0 (schema uses 0=Mon..6=Sun).
const MONDAY = '2026-05-04';
const TUESDAY = '2026-05-05';

describe('ensurePlannedLogsForDate', () => {
  beforeEach(async () => {
    await Promise.all([
      db.nutrition_logs.clear(),
      db.nutrition_week_meals.clear(),
      db.nutrition_day_notes.clear(),
    ]);
  });

  it('materializes the standard-week template into nutrition_logs for the matching DOW', async () => {
    await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'breakfast',
      meal_name: 'Oats',
      calories: 350,
      protein_g: 20,
    });
    await setWeekMeal({
      day_of_week: 0,
      meal_slot: 'lunch',
      meal_name: 'Salad',
      calories: 500,
      protein_g: 35,
    });

    await ensurePlannedLogsForDate(MONDAY);

    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .toArray();
    expect(logs).toHaveLength(2);

    const breakfast = logs.find(l => l.meal_type === 'breakfast');
    expect(breakfast).toMatchObject({
      meal_name: 'Oats',
      calories: 350,
      protein_g: 20,
      status: 'planned',
    });
    expect(breakfast?.template_meal_id).toBeTruthy();

    const lunch = logs.find(l => l.meal_type === 'lunch');
    expect(lunch).toMatchObject({
      meal_name: 'Salad',
      calories: 500,
      status: 'planned',
    });
  });

  it('stamps day_notes.template_applied_at so re-runs are no-ops', async () => {
    await setWeekMeal({ day_of_week: 0, meal_slot: 'snack', meal_name: 'Apple' });

    await ensurePlannedLogsForDate(MONDAY);
    const note = await db.nutrition_day_notes.filter(n => n.date === MONDAY).first();
    expect(note?.template_applied_at).toBeTruthy();

    // Run again — should not duplicate logs.
    await ensurePlannedLogsForDate(MONDAY);
    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(MONDAY))
      .toArray();
    expect(logs).toHaveLength(1);
  });

  it('does not resurrect logs the user has soft-deleted', async () => {
    await setWeekMeal({ day_of_week: 0, meal_slot: 'breakfast', meal_name: 'Oats' });

    await ensurePlannedLogsForDate(MONDAY);
    const original = await db.nutrition_logs.filter(l => l.logged_at.startsWith(MONDAY)).toArray();
    const id = original[0].uuid;

    // User deletes the planned row, then clears the day-note stamp to simulate
    // a stale client (or admin reset). The cross-device guard should still
    // prevent recreating a row whose template_meal_id is already in use.
    await db.nutrition_logs.update(id, { _deleted: true });
    const note = await db.nutrition_day_notes.filter(n => n.date === MONDAY).first();
    if (note) await db.nutrition_day_notes.update(note.uuid, { template_applied_at: null });

    await ensurePlannedLogsForDate(MONDAY);
    const all = await db.nutrition_logs.filter(l => l.logged_at.startsWith(MONDAY)).toArray();
    // Only the soft-deleted original — no fresh row resurrected.
    expect(all).toHaveLength(1);
    expect(all[0]._deleted).toBe(true);
  });

  it('stamps the day note even when the DOW has no template (so we do not re-scan forever)', async () => {
    // Tuesday has no template meals.
    await ensurePlannedLogsForDate(TUESDAY);
    const note = await db.nutrition_day_notes.filter(n => n.date === TUESDAY).first();
    expect(note?.template_applied_at).toBeTruthy();
    const logs = await db.nutrition_logs
      .filter(l => l.logged_at.startsWith(TUESDAY))
      .toArray();
    expect(logs).toHaveLength(0);
  });

  it('rejects malformed date strings without throwing', async () => {
    await expect(ensurePlannedLogsForDate('not-a-date')).resolves.toBeUndefined();
    const all = await db.nutrition_day_notes.toArray();
    expect(all).toHaveLength(0);
  });
});
