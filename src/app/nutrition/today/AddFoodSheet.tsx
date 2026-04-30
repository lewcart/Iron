'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { logMeal } from '@/lib/mutations-nutrition';
import { rebirthJsonHeaders } from '@/lib/api/headers';
import { safeParseNumber } from '@/lib/nutrition-time';
import type { MealSlot } from './MealSection';
import type { FoodResult } from '@/app/api/nutrition/foods/route';

interface Props {
  open: boolean;
  onClose: () => void;
  slot: MealSlot;
  /** Date this meal is being logged for (YYYY-MM-DD). */
  date: string;
}

interface SearchResponse {
  layer1: FoodResult[];
  layer2: FoodResult[];
  layer3: FoodResult[];
  combined: FoodResult[];
}

export function AddFoodSheet({ open, onClose, slot, date }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FoodResult | null>(null);
  const [manual, setManual] = useState({ name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
  const [saving, setSaving] = useState(false);

  // Reset state when sheet opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(null);
      setManual({ name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
    }
  }, [open]);

  // Run search when query changes.
  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/nutrition/foods?q=${encodeURIComponent(query.trim())}&limit=20`, {
      headers: rebirthJsonHeaders(),
    })
      .then((r) => (r.ok ? (r.json() as Promise<SearchResponse>) : null))
      .then((data) => {
        if (cancelled) return;
        setResults(data?.combined ?? []);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, open]);

  // Build the logged_at timestamp: today → now; past/future → noon of that date.
  function buildLoggedAt(): string {
    const today = new Date().toISOString().slice(0, 10);
    if (date === today) return new Date().toISOString();
    return new Date(date + 'T12:00:00').toISOString();
  }

  async function saveSelected() {
    if (!selected) return;
    setSaving(true);
    try {
      await logMeal({
        meal_type: slot,
        meal_name: selected.food_name,
        calories: selected.calories ?? null,
        protein_g: selected.protein_g ?? null,
        carbs_g: selected.carbs_g ?? null,
        fat_g: selected.fat_g ?? null,
        status: 'added',
        logged_at: buildLoggedAt(),
      });
      // Seed L1 with this food so the next search hits it locally instead of
      // round-tripping to OFF/USDA. Best-effort — sync errors don't block log.
      if (selected.source !== 'local') {
        fetch('/api/nutrition/foods', {
          method: 'POST',
          headers: rebirthJsonHeaders(),
          body: JSON.stringify({
            food_name: selected.food_name,
            source: selected.source,
            calories: selected.calories,
            protein_g: selected.protein_g,
            carbs_g: selected.carbs_g,
            fat_g: selected.fat_g,
            nutrients: selected.nutrients,
            external_id: selected.external_id,
          }),
        }).catch(() => {});
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function saveManual() {
    if (!manual.name.trim()) return;
    setSaving(true);
    try {
      await logMeal({
        meal_type: slot,
        meal_name: manual.name.trim(),
        calories: safeParseNumber(manual.calories),
        protein_g: safeParseNumber(manual.protein_g),
        carbs_g: safeParseNumber(manual.carbs_g),
        fat_g: safeParseNumber(manual.fat_g),
        status: 'added',
        logged_at: buildLoggedAt(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // Confirm screen: user picked a search result.
  if (selected) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={`Add to ${slot}`}
        height="auto"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelected(null)} className="flex-1">
              Back
            </Button>
            <Button onClick={saveSelected} disabled={saving} className="flex-1">
              {saving ? 'Adding…' : 'Add'}
            </Button>
          </div>
        }
      >
        <div className="p-4 space-y-3">
          <div className="text-sm font-medium">{selected.food_name}</div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <Macro label="Cal" value={selected.calories} />
            <Macro label="Pro" value={selected.protein_g} unit="g" />
            <Macro label="Carb" value={selected.carbs_g} unit="g" />
            <Macro label="Fat" value={selected.fat_g} unit="g" />
          </div>
          {selected.meta?.times_logged != null && (
            <div className="text-xs text-muted-foreground">
              Logged {selected.meta.times_logged}x previously
            </div>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Add to ${slot}`} height="90vh">
      <div className="p-4 space-y-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search foods…"
          autoFocus
        />

        {loading && <div className="text-xs text-muted-foreground">Searching…</div>}

        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="space-y-3 py-2">
            <div className="text-sm text-muted-foreground">No matches.</div>
            <Button
              variant="secondary"
              onClick={() => setManual((m) => ({ ...m, name: query.trim() }))}
              className="w-full"
            >
              Add &ldquo;{query.trim()}&rdquo; manually
            </Button>
          </div>
        )}

        {!loading && results.length > 0 && (
          <ul className="ios-section divide-y divide-border/40">
            {results.map((r, i) => (
              <li key={`${r.source}-${r.food_name}-${i}`}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className="w-full ios-row py-2.5 text-left hover:bg-muted/30 flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.food_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.protein_g != null && `${Math.round(r.protein_g)}p `}
                      {r.carbs_g != null && `${Math.round(r.carbs_g)}c `}
                      {r.fat_g != null && `${Math.round(r.fat_g)}f`}
                    </div>
                  </div>
                  <div className="text-sm tabular-nums">
                    {r.calories != null ? `${Math.round(r.calories)} kcal` : '—'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="pt-3 border-t border-border/40">
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Or add manually
          </div>
          <div className="space-y-2">
            <input
              value={manual.name}
              onChange={(e) => setManual((m) => ({ ...m, name: e.target.value }))}
              placeholder="Food name"
              className="w-full h-10 px-3 rounded-lg bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="grid grid-cols-4 gap-2">
              <ManualField
                label="Cal"
                value={manual.calories}
                onChange={(v) => setManual((m) => ({ ...m, calories: v }))}
              />
              <ManualField
                label="Pro"
                value={manual.protein_g}
                onChange={(v) => setManual((m) => ({ ...m, protein_g: v }))}
              />
              <ManualField
                label="Carb"
                value={manual.carbs_g}
                onChange={(v) => setManual((m) => ({ ...m, carbs_g: v }))}
              />
              <ManualField
                label="Fat"
                value={manual.fat_g}
                onChange={(v) => setManual((m) => ({ ...m, fat_g: v }))}
              />
            </div>
            <Button
              onClick={saveManual}
              disabled={!manual.name.trim() || saving}
              className="w-full"
            >
              {saving ? 'Adding…' : 'Add manually'}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function Macro({ label, value, unit }: { label: string; value: number | null | undefined; unit?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">
        {value != null ? Math.round(value) : '—'}
        {value != null && unit ? <span className="text-[10px] text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

function ManualField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-center">
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 rounded-lg bg-muted/40 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
