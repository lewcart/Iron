import { describe, it, expect } from 'vitest';
import {
  parseFoodEntriesCsv,
  parseWaterCsv,
  parseWeightCsv,
  parseActivityCsv,
  dayLocalFromFoodDate,
} from './parse';
import { foodEntryDedupeKey } from './dedupe';

describe('dayLocalFromFoodDate', () => {
  it('extracts YYYY-MM-DD from Fitbee ISO', () => {
    expect(dayLocalFromFoodDate('2026-02-27T00:00:00+1000')).toBe('2026-02-27');
  });
});

describe('parseFoodEntriesCsv', () => {
  const sample = `date,meal,food_name,calories (kcal),protein (g),carbohydrate (g),total_fat (g),sodium (mg)
2026-02-27T00:00:00+1000,Lunch,Lazy Lunch - Tuna,464.0,33.25,52.59,10.53,0.0
2026-02-27T00:00:00+1000,Breakfast,Tofu Protein Smoothie,571.0,51.07,27.09,17.57,0.03
2026-01-10T00:00:00+1000,Lunch,Caprese Weekend Eggs,427.0,28.25,46.5,12.88,0.3`;

  it('parses rows and macros', () => {
    const { rows, warnings } = parseFoodEntriesCsv(sample);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(3);
    const tuna = rows.find((r) => r.food_name.includes('Tuna'));
    expect(tuna?.meal_type).toBe('lunch');
    expect(tuna?.day_local).toBe('2026-02-27');
    expect(tuna?.calories).toBe(464);
    expect(tuna?.protein_g).toBe(33.25);
    expect(tuna?.carbs_g).toBe(52.59);
    expect(tuna?.fat_g).toBe(10.53);
    expect(tuna?.nutrients['sodium (mg)']).toBe(0);
  });

  it('maps Snacks to snack', () => {
    const csv = `date,meal,food_name,calories (kcal),protein (g),carbohydrate (g),total_fat (g)
2026-01-01T00:00:00+1000,Snacks,Bar,100,10,5,2`;
    const { rows } = parseFoodEntriesCsv(csv);
    expect(rows[0]?.meal_type).toBe('snack');
  });

  it('dedupe key is stable for same row', () => {
    const { rows } = parseFoodEntriesCsv(sample);
    const a = foodEntryDedupeKey(rows[0]!);
    const b = foodEntryDedupeKey(rows[0]!);
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });
});

describe('parseWeightCsv', () => {
  it('parses weight rows', () => {
    const csv = `date,weight_entry (kg),notes
2026-02-27T05:35:54+1000,56.5,
2026-01-31T09:28:46+1000,58.6,post-trip`;
    const { rows, warnings } = parseWeightCsv(csv);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.weight_kg).toBe(56.5);
    expect(rows[1]!.note).toBe('post-trip');
  });
});

describe('parseActivityCsv', () => {
  it('parses workouts csv', () => {
    const csv = `date,workout,energy burned (cal)
2026-03-26T06:36:23+1000,Traditional Strength Training,270.0
2026-03-18T06:06:28+1000,Walking,111.0`;
    const { rows, warnings } = parseActivityCsv(csv);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.activity_name).toBe('Traditional Strength Training');
    expect(rows[0]!.calories_burned).toBe(270);
  });
});

describe('parseWaterCsv', () => {
  it('parses water rows', () => {
    const csv = `date,water (mL)
2026-03-01T00:00:00+1000,2000
2026-03-02T00:00:00+1000,1500`;
    const { rows } = parseWaterCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.date).toBe('2026-03-01');
    expect(rows[0]!.ml).toBe(2000);
  });
});
