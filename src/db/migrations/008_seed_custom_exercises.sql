-- Seed custom exercises missing from the built-in Everkinetic library.
-- everkinetic_id = 0 is the sentinel for custom/non-Everkinetic entries.
--
-- Muscle arrays use canonical slugs as defined in migration 026
-- (src/db/migrations/026_canonical_muscles.sql). Pre-023 values like
-- "lower back" / "tensor fasciae latae" / "hip abductors" were rewritten
-- in place 2026-05-01 as part of the canonical taxonomy rollout.

INSERT INTO exercises (uuid, everkinetic_id, title, alias, description, primary_muscles, secondary_muscles, equipment, is_custom)
VALUES
  (
    gen_random_uuid(),
    0,
    'Romanian Deadlift: Dumbbell',
    '["DB Romanian Deadlift", "Dumbbell RDL", "DB RDL"]',
    'A hip-hinge movement performed with dumbbells. Hold a dumbbell in each hand in front of the thighs, hinge at the hips while maintaining a neutral spine, lowering the weights along the legs until a strong hamstring stretch is felt, then drive the hips forward to return to standing.',
    '["hamstrings", "glutes"]',
    '["erectors", "core", "forearms"]',
    '["dumbbell"]',
    true
  ),
  (
    gen_random_uuid(),
    0,
    'Cable Hip Abduction',
    '["Cable Hip Abduction", "Cable Side Raise", "Standing Cable Abduction"]',
    'Attach an ankle cuff to a low cable pulley. Stand sideways to the machine with the cuff on the far ankle. Keeping the leg straight, raise it out to the side against the cable resistance, squeezing the glute medius at the top, then lower under control.',
    '["glutes", "hip_abductors"]',
    '["core"]',
    '["cable machine"]',
    true
  )
ON CONFLICT DO NOTHING;
