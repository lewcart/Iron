#!/usr/bin/env node
/**
 * Seed nutrition_food_entries with a starter catalog of common foods so the
 * AddFoodSheet's Layer-1 (local) search returns hits before any Fitbee import
 * has happened. Open Food Facts (Layer 2) is unreliable and biased toward
 * branded products; this seeds plain whole-foods + UK staples Lou actually
 * tracks.
 *
 * Idempotent: each entry has a stable dedupe_key; ON CONFLICT DO NOTHING means
 * re-running is safe and won't duplicate rows.
 *
 * Run:  node scripts/seed-nutrition-foods.mjs
 *
 * Macros are per 100g for ingredients, per typical serving for prepared items.
 * Sources: USDA SR-Legacy reference values + UK supermarket label averages.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const url = env.match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1];
if (!url) throw new Error('DATABASE_URL not found in .env.local');
const sql = neon(url);

// [name, calories, protein_g, carbs_g, fat_g, serving_label]
// Macros are PER 100g unless serving_label says otherwise.
const FOODS = [
  // Proteins (per 100g raw)
  ['Chicken breast (per 100g raw)', 165, 31, 0, 3.6],
  ['Chicken thigh (per 100g raw)', 209, 26, 0, 11],
  ['Beef mince 5% (per 100g raw)', 138, 21, 0, 5],
  ['Beef mince 20% (per 100g raw)', 254, 17, 0, 20],
  ['Beef steak (per 100g raw)', 217, 26, 0, 12],
  ['Pork loin (per 100g raw)', 143, 21, 0, 6],
  ['Bacon (per 100g cooked)', 541, 37, 1.4, 42],
  ['Salmon fillet (per 100g raw)', 208, 20, 0, 13],
  ['Tuna in water (per 100g)', 116, 26, 0, 1],
  ['Cod fillet (per 100g raw)', 82, 18, 0, 0.7],
  ['Prawns (per 100g cooked)', 99, 24, 0, 0.3],
  ['Whole egg (per egg)', 72, 6.3, 0.4, 5],
  ['Egg white (per white)', 17, 3.6, 0.2, 0.1],
  ['Tofu firm (per 100g)', 144, 17, 2.8, 8],
  ['Greek yogurt 0% fat (per 100g)', 59, 10, 3.6, 0.4],
  ['Greek yogurt full fat (per 100g)', 97, 9, 4, 5],
  ['Cottage cheese (per 100g)', 98, 11, 3.4, 4.3],
  ['Whey protein (per 30g scoop)', 120, 24, 3, 1.5],

  // Carbs / grains (per 100g raw / dry unless noted)
  ['White rice (per 100g cooked)', 130, 2.7, 28, 0.3],
  ['Brown rice (per 100g cooked)', 112, 2.6, 24, 0.9],
  ['Basmati rice (per 100g cooked)', 121, 3, 25, 0.4],
  ['Jasmine rice (per 100g cooked)', 129, 2.7, 28, 0.2],
  ['Pasta (per 100g cooked)', 158, 5.8, 31, 0.9],
  ['Wholewheat pasta (per 100g cooked)', 124, 5, 26, 1.4],
  ['Couscous (per 100g cooked)', 112, 3.8, 23, 0.2],
  ['Quinoa (per 100g cooked)', 120, 4.4, 21, 1.9],
  ['Oats rolled (per 100g dry)', 379, 13, 68, 6.5],
  ['Oats porridge (per 40g serve)', 152, 5.2, 27, 2.6],
  ['Bread white slice (per slice 35g)', 89, 2.9, 17, 1],
  ['Bread wholemeal slice (per slice 35g)', 89, 4, 15, 1.3],
  ['Sourdough slice (per slice 50g)', 130, 4.5, 26, 0.8],
  ['Bagel plain (per bagel 95g)', 257, 10, 51, 1.5],
  ['Wrap tortilla (per wrap 60g)', 180, 5, 30, 4.5],
  ['Potato boiled (per 100g)', 87, 1.9, 20, 0.1],
  ['Sweet potato baked (per 100g)', 90, 2, 21, 0.1],
  ['Chips oven (per 100g)', 162, 2.7, 25, 5.4],

  // Fruits (per 100g unless noted)
  ['Banana (per medium 118g)', 105, 1.3, 27, 0.4],
  ['Apple (per medium 180g)', 95, 0.5, 25, 0.3],
  ['Orange (per medium 140g)', 62, 1.2, 15, 0.2],
  ['Strawberries (per 100g)', 32, 0.7, 7.7, 0.3],
  ['Blueberries (per 100g)', 57, 0.7, 14, 0.3],
  ['Raspberries (per 100g)', 52, 1.2, 12, 0.7],
  ['Grapes (per 100g)', 69, 0.7, 18, 0.2],
  ['Pineapple (per 100g)', 50, 0.5, 13, 0.1],
  ['Mango (per 100g)', 60, 0.8, 15, 0.4],
  ['Avocado (per medium 200g)', 322, 4, 17, 30],
  ['Avocado (per 100g)', 160, 2, 8.5, 15],

  // Vegetables (per 100g)
  ['Broccoli (per 100g)', 35, 2.4, 7.2, 0.4],
  ['Spinach (per 100g)', 23, 2.9, 3.6, 0.4],
  ['Kale (per 100g)', 49, 4.3, 9, 0.9],
  ['Carrot (per 100g)', 41, 0.9, 10, 0.2],
  ['Tomato (per 100g)', 18, 0.9, 3.9, 0.2],
  ['Cucumber (per 100g)', 16, 0.7, 3.6, 0.1],
  ['Lettuce (per 100g)', 15, 1.4, 2.9, 0.2],
  ['Onion (per 100g)', 40, 1.1, 9.3, 0.1],
  ['Bell pepper (per 100g)', 31, 1, 6, 0.3],
  ['Mushrooms (per 100g)', 22, 3.1, 3.3, 0.3],
  ['Asparagus (per 100g)', 20, 2.2, 3.9, 0.1],
  ['Courgette (per 100g)', 17, 1.2, 3.1, 0.3],
  ['Aubergine (per 100g)', 25, 1, 6, 0.2],
  ['Green beans (per 100g)', 31, 1.8, 7, 0.2],
  ['Peas (per 100g)', 81, 5.4, 14, 0.4],

  // Dairy (per 100g/100ml unless noted)
  ['Whole milk (per 100ml)', 61, 3.3, 4.7, 3.3],
  ['Semi-skimmed milk (per 100ml)', 47, 3.4, 4.8, 1.7],
  ['Skimmed milk (per 100ml)', 35, 3.4, 5, 0.1],
  ['Almond milk unsweetened (per 100ml)', 13, 0.4, 0.1, 1.1],
  ['Oat milk (per 100ml)', 47, 1, 6.6, 1.5],
  ['Cheddar cheese (per 100g)', 402, 25, 1.3, 33],
  ['Mozzarella (per 100g)', 280, 28, 3.1, 17],
  ['Feta (per 100g)', 264, 14, 4.1, 21],
  ['Parmesan (per 100g)', 431, 38, 4.1, 29],
  ['Butter (per 10g knob)', 72, 0.1, 0, 8],

  // Nuts / fats
  ['Almonds (per 30g handful)', 173, 6.3, 6.5, 15],
  ['Peanuts (per 30g handful)', 170, 7.7, 4.9, 14],
  ['Cashews (per 30g handful)', 165, 5.4, 9.2, 13],
  ['Walnuts (per 30g handful)', 196, 4.6, 4.1, 20],
  ['Peanut butter (per 1 tbsp 16g)', 95, 3.5, 3.5, 8],
  ['Olive oil (per 1 tbsp 14g)', 119, 0, 0, 14],
  ['Coconut oil (per 1 tbsp 14g)', 117, 0, 0, 14],

  // Legumes (per 100g cooked)
  ['Black beans (per 100g cooked)', 132, 8.9, 24, 0.5],
  ['Kidney beans (per 100g cooked)', 127, 8.7, 23, 0.5],
  ['Chickpeas (per 100g cooked)', 164, 8.9, 27, 2.6],
  ['Lentils (per 100g cooked)', 116, 9, 20, 0.4],
  ['Hummus (per 100g)', 166, 7.9, 14, 9.6],

  // Common UK takeaway / prepared
  ['Sushi salmon roll (per 6 pieces)', 290, 9, 50, 5.7],
  ['Pizza margherita (per slice 100g)', 266, 11, 33, 10],
  ['Burger beef plain (per burger)', 540, 25, 40, 31],
  ['Crisps ready salted (per 25g bag)', 134, 1.5, 13, 8.4],
  ['Dark chocolate 70% (per 25g square)', 149, 1.9, 11, 11],
  ['Protein bar (per 60g bar)', 230, 20, 22, 7],

  // Drinks
  ['Coffee black (per cup)', 2, 0.3, 0, 0],
  ['Latte semi-skimmed (per medium 300ml)', 137, 9.8, 14, 4.9],
  ['Cappuccino (per medium 300ml)', 88, 6.4, 9, 3.2],
  ['Beer pint (per 568ml)', 215, 1.7, 15, 0],
  ['Wine red (per 175ml glass)', 152, 0.1, 4, 0],
  ['Wine white (per 175ml glass)', 147, 0.1, 1.5, 0],
];

function dedupe(name) {
  return `seed:starter:${name.toLowerCase()}`;
}

const today = new Date().toISOString();
const dayLocal = today.slice(0, 10);

let inserted = 0;
let skipped = 0;

for (const [name, cal, pro, carb, fat] of FOODS) {
  const result = await sql`
    INSERT INTO nutrition_food_entries
      (uuid, logged_at, day_local, meal_type, food_name, calories, protein_g, carbs_g, fat_g, nutrients, source, dedupe_key)
    VALUES
      (${randomUUID()}, ${today}::timestamptz, ${dayLocal}, 'other', ${name}, ${cal}, ${pro}, ${carb}, ${fat}, '{}'::jsonb, 'seed', ${dedupe(name)})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING uuid
  `;
  if (result.length > 0) inserted++;
  else skipped++;
}

console.log(`Seed complete: ${inserted} inserted, ${skipped} already present (${FOODS.length} total).`);

const total = await sql`SELECT COUNT(*)::int AS c FROM nutrition_food_entries WHERE source = 'seed'`;
console.log(`nutrition_food_entries(source='seed') total: ${total[0].c}`);
