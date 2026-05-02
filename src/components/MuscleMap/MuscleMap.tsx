'use client';

import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import Body, { type ExtendedBodyPart } from 'react-muscle-highlighter';
import { MUSCLE_DEFS, type MuscleSlug } from '@/lib/muscles';
import {
  getMuscleGroupColor,
  getMuscleGroupColorDark,
  getMuscleGroupColorLight,
} from '@/lib/muscle-colors';
import { cn } from '@/lib/utils';
import { SLUG_TO_LIB, isDeep, type LibSlug } from './slug-map';

export interface MuscleMapProps {
  primary: readonly MuscleSlug[];
  secondary: readonly MuscleSlug[];
  className?: string;
  /** Defaults to 'female' — match the user's silhouette preference. */
  gender?: 'female' | 'male';
}

type Role = 'primary' | 'secondary';

/**
 * Body diagram + pill summary for an exercise's target muscles.
 *
 * Renders front + back silhouettes side-by-side via react-muscle-highlighter.
 * Primary muscles fill in their parent-group hue; secondary in a lighter
 * variant of the same hue. Two of our canonical slugs (rotator_cuff,
 * hip_abductors) are "deep" — the library has no matching region, so they
 * surface in the pill row only with a Layers icon.
 */
export function MuscleMap({ primary, secondary, className, gender = 'female' }: MuscleMapProps) {
  // Map: lib slug → ExtendedBodyPart styles. Primary wins over secondary
  // for any given body region. Primary gets a darker stroke ring; secondary
  // is lighter fill, no stroke.
  const partsByLibSlug = useMemo(() => {
    const m = new Map<LibSlug, ExtendedBodyPart>();
    for (const slug of secondary) {
      const libSlugs = SLUG_TO_LIB[slug];
      if (!libSlugs) continue;
      const fill = getMuscleGroupColorLight(MUSCLE_DEFS[slug].parent_group);
      for (const lib of libSlugs) {
        m.set(lib, {
          slug: lib as ExtendedBodyPart['slug'],
          styles: { fill, stroke: 'none', strokeWidth: 0 },
        });
      }
    }
    for (const slug of primary) {
      const libSlugs = SLUG_TO_LIB[slug];
      if (!libSlugs) continue;
      const group = MUSCLE_DEFS[slug].parent_group;
      const fill = getMuscleGroupColor(group);
      const stroke = getMuscleGroupColorDark(group);
      for (const lib of libSlugs) {
        m.set(lib, {
          slug: lib as ExtendedBodyPart['slug'],
          styles: { fill, stroke, strokeWidth: 2 },
        });
      }
    }
    return m;
  }, [primary, secondary]);

  const bodyData: ExtendedBodyPart[] = useMemo(
    () => [...partsByLibSlug.values()],
    [partsByLibSlug],
  );

  // Pills: primary first, secondary after, sorted by display_order within group.
  const pillSlugs = useMemo(
    () =>
      [...primary, ...secondary].sort(
        (a, b) => MUSCLE_DEFS[a].display_order - MUSCLE_DEFS[b].display_order,
      ),
    [primary, secondary],
  );

  const roleBySlug = useMemo(() => {
    const m = new Map<MuscleSlug, Role>();
    for (const s of secondary) m.set(s, 'secondary');
    for (const s of primary) m.set(s, 'primary'); // primary wins
    return m;
  }, [primary, secondary]);

  const hasDeep = pillSlugs.some(isDeep);
  const hasSecondary = secondary.length > 0;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <PillRow slugs={pillSlugs} roleBySlug={roleBySlug} />

      <div className="flex justify-center gap-2">
        <div className="flex-1 max-w-[180px]">
          <Body data={bodyData} side="front" gender={gender} scale={1} />
        </div>
        <div className="flex-1 max-w-[180px]">
          <Body data={bodyData} side="back" gender={gender} scale={1} />
        </div>
      </div>

      {(hasSecondary || hasDeep) && <Legend hasSecondary={hasSecondary} hasDeep={hasDeep} />}
    </div>
  );
}

// ── pill row ────────────────────────────────────────────────────────────

function PillRow({
  slugs,
  roleBySlug,
}: {
  slugs: MuscleSlug[];
  roleBySlug: Map<MuscleSlug, Role>;
}) {
  if (slugs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {slugs.map((slug) => {
        const role = roleBySlug.get(slug) ?? 'secondary';
        const def = MUSCLE_DEFS[slug];
        const color = getMuscleGroupColor(def.parent_group);
        const deep = isDeep(slug);
        return (
          <span
            key={slug}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
            style={
              role === 'primary'
                ? { backgroundColor: color, borderColor: color, color: '#fff' }
                : { borderColor: color, color }
            }
          >
            {deep && <Layers size={10} aria-hidden="true" />}
            {def.display_name}
          </span>
        );
      })}
    </div>
  );
}

// ── legend ──────────────────────────────────────────────────────────────

function Legend({ hasSecondary, hasDeep }: { hasSecondary: boolean; hasDeep: boolean }) {
  // Use one representative hue (chest) for both swatches so the legend
  // demonstrates the primary-vs-secondary encoding (saturated + bordered vs
  // lighter fill) without committing to any specific muscle group. Pulled
  // from getMuscleGroupColor* so palette changes flow through automatically.
  const exampleFill = getMuscleGroupColor('chest');
  const exampleStroke = getMuscleGroupColorDark('chest');
  const exampleLight = getMuscleGroupColorLight('chest');
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: exampleFill, border: `1.5px solid ${exampleStroke}` }}
        />
        Primary
      </span>
      {hasSecondary && (
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: exampleLight }}
          />
          Secondary
        </span>
      )}
      {hasDeep && (
        <span className="inline-flex items-center gap-1">
          <Layers size={10} aria-hidden="true" />
          Deep
        </span>
      )}
    </div>
  );
}
