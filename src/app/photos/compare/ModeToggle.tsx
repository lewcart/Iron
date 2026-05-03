'use client';

import { ArrowLeftRight, Columns2, Layers2, Contrast, PersonStanding } from 'lucide-react';

export type CompareMode = 'slide' | 'side' | 'blend' | 'diff' | 'silhouette';

export const MODE_ORDER: CompareMode[] = ['slide', 'side', 'blend', 'diff', 'silhouette'];

const MODE_META: Record<CompareMode, { label: string; ariaLabel: string; Icon: typeof ArrowLeftRight }> = {
  slide:      { label: 'Slide',   ariaLabel: 'Slider comparison',     Icon: ArrowLeftRight },
  side:       { label: 'Side',    ariaLabel: 'Side-by-side comparison', Icon: Columns2 },
  blend:      { label: 'Blend',   ariaLabel: 'Onion-skin blend comparison', Icon: Layers2 },
  diff:       { label: 'Diff',    ariaLabel: 'Difference overlay comparison', Icon: Contrast },
  silhouette: { label: 'Outline', ariaLabel: 'Silhouette outline comparison', Icon: PersonStanding },
};

export function isCompareMode(v: string | null | undefined): v is CompareMode {
  return v === 'slide' || v === 'side' || v === 'blend' || v === 'diff' || v === 'silhouette';
}

interface Props {
  mode: CompareMode;
  onChange: (mode: CompareMode) => void;
  accent: 'trans-blue' | 'trans-pink';
  /** When silhouette can't be used on this device (no Capacitor plugin). */
  silhouetteAvailable: boolean;
}

/** Equal-width segmented control with icon + short label. Each option meets
 *  the 44pt minimum touch target. ARIA tablist semantics so screen readers
 *  announce the active mode by full name (not the abbreviated label). */
export function ModeToggle({ mode, onChange, accent, silhouetteAvailable }: Props) {
  const activeBg = accent === 'trans-blue' ? 'bg-trans-blue/20 text-trans-blue' : 'bg-trans-pink/20 text-trans-pink';

  return (
    <div role="tablist" aria-label="Compare mode" className="flex gap-1 p-1 bg-white/5 rounded-lg min-h-[48px]">
      {MODE_ORDER.map((m) => {
        const meta = MODE_META[m];
        const isActive = m === mode;
        const isDisabled = m === 'silhouette' && !silhouetteAvailable;
        const cls = isActive
          ? activeBg
          : isDisabled
            ? 'text-white/25'
            : 'text-white/60';
        return (
          <button
            key={m}
            role="tab"
            aria-selected={isActive}
            aria-label={meta.ariaLabel}
            disabled={isDisabled}
            onClick={() => onChange(m)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium rounded-md transition-colors min-h-[44px] ${cls}`}
          >
            <meta.Icon className="h-4 w-4" />
            <span className="uppercase tracking-wide">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
