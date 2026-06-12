-- Rollback for migration 052.

DROP VIEW IF EXISTS nutrition_week_meal_effective;

ALTER TABLE nutrition_week_meals
  DROP COLUMN IF EXISTS is_recipe;

DROP TABLE IF EXISTS week_meal_ingredients;
DROP TABLE IF EXISTS foods;
