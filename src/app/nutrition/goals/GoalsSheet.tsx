'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { setNutritionTargets } from '@/lib/mutations-nutrition';
import { useNutritionTargets } from '@/lib/useLocalDB-nutrition';
import { safeParseNumber } from '@/lib/nutrition-time';
import type { MacroBands } from '@/db/local';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Preset {
  label: string;
  cal: number;
  pro: number;
  carb: number;
  fat: number;
}

// Generic presets — a starting point. User edits to taste.
const PRESETS: Preset[] = [
  { label: 'Cut',      cal: 2000, pro: 180, carb: 180, fat: 60 },
  { label: 'Maintain', cal: 2400, pro: 160, carb: 240, fat: 80 },
  { label: 'Bulk',     cal: 2800, pro: 180, carb: 320, fat: 90 },
];

const DEFAULT_BANDS: MacroBands = {
  cal:  { low: -0.10, high: 0.10 },
  pro:  { low: -0.10, high: null },
  carb: { low: -0.15, high: 0.15 },
  fat:  { low: -0.15, high: 0.20 },
};

export function GoalsSheet({ open, onClose }: Props) {
  const targets = useNutritionTargets();

  const [cal, setCal] = useState('');
  const [pro, setPro] = useState('');
  const [carb, setCarb] = useState('');
  const [fat, setFat] = useState('');
  const [bands, setBands] = useState<MacroBands>(DEFAULT_BANDS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hydrate from current targets when opening.
  useEffect(() => {
    if (!open) return;
    setCal(targets?.calories?.toString() ?? '');
    setPro(targets?.protein_g?.toString() ?? '');
    setCarb(targets?.carbs_g?.toString() ?? '');
    setFat(targets?.fat_g?.toString() ?? '');
    setBands(targets?.bands ?? DEFAULT_BANDS);
  }, [open, targets]);

  function applyPreset(p: Preset) {
    setCal(p.cal.toString());
    setPro(p.pro.toString());
    setCarb(p.carb.toString());
    setFat(p.fat.toString());
  }

  async function save() {
    setSaving(true);
    try {
      await setNutritionTargets({
        calories: safeParseNumber(cal),
        protein_g: safeParseNumber(pro),
        carbs_g: safeParseNumber(carb),
        fat_g: safeParseNumber(fat),
        bands,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Daily goals"
      height="auto"
      footer={
        <Button onClick={save} disabled={saving} className="w-full">
          {saving ? 'Saving…' : 'Save goals'}
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">Presets</div>
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className="flex-1 h-9 rounded-lg bg-muted/40 hover:bg-muted text-sm font-medium transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Calories" unit="kcal" value={cal} onChange={setCal} />
          <Field label="Protein" unit="g" value={pro} onChange={setPro} />
          <Field label="Carbs" unit="g" value={carb} onChange={setCarb} />
          <Field label="Fat" unit="g" value={fat} onChange={setFat} />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showAdvanced ? '▾ Hide' : '▸ Show'} advanced (per-macro adherence bands)
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-2 text-xs">
              <BandRow
                macro="cal"
                label="Calories"
                bands={bands}
                onChange={setBands}
              />
              <BandRow
                macro="pro"
                label="Protein"
                bands={bands}
                onChange={setBands}
              />
              <BandRow
                macro="carb"
                label="Carbs"
                bands={bands}
                onChange={setBands}
              />
              <BandRow
                macro="fat"
                label="Fat"
                bands={bands}
                onChange={setBands}
              />
              <div className="text-[11px] text-muted-foreground pt-2">
                Bands are tolerances around each goal. Negative = under, positive = over.
                Leave a value blank for &ldquo;no upper penalty&rdquo;.
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Field({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">
        {label} <span className="text-[10px]">({unit})</span>
      </div>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full h-10 px-3 rounded-lg bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
      />
    </label>
  );
}

type BandKey = keyof MacroBands;

function BandRow({
  macro,
  label,
  bands,
  onChange,
}: {
  macro: BandKey;
  label: string;
  bands: MacroBands;
  onChange: (next: MacroBands) => void;
}) {
  const band = bands[macro] ?? { low: -0.10, high: 0.10 };
  const lowPct = Math.round(band.low * 100);
  const highPct = band.high == null ? '' : Math.round(band.high * 100);

  function update(field: 'low' | 'high', raw: string) {
    const trimmed = raw.trim();
    const next: MacroBands = { ...bands };
    const cur = next[macro] ?? { low: -0.10, high: 0.10 };
    if (field === 'high' && trimmed === '') {
      next[macro] = { ...cur, high: null };
    } else {
      const n = parseFloat(trimmed);
      if (Number.isFinite(n)) {
        next[macro] = { ...cur, [field]: n / 100 };
      }
    }
    onChange(next);
  }

  return (
    <div className="grid grid-cols-[1fr_70px_70px] items-center gap-2">
      <span>{label}</span>
      <label className="block">
        <span className="sr-only">Lower bound</span>
        <input
          inputMode="numeric"
          value={lowPct}
          onChange={(e) => update('low', e.target.value)}
          className="w-full h-8 px-2 rounded bg-muted/40 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <label className="block">
        <span className="sr-only">Upper bound</span>
        <input
          inputMode="numeric"
          value={highPct}
          onChange={(e) => update('high', e.target.value)}
          placeholder="—"
          className="w-full h-8 px-2 rounded bg-muted/40 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
    </div>
  );
}
