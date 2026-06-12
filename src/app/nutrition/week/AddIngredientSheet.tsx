'use client';

/**
 * AddIngredientSheet — sheet for searching/creating a food and attaching it
 * as an ingredient to a Standard Week meal.
 *
 * Flow:
 *  1. Search: min-2-char gate, "Searching…" state, results list.
 *  2. Select result → amount entry screen (pre-filled with food's natural
 *     serving; unit label shown; gram-native where available).
 *  3. No match → "Add [query] manually" → manual macro entry → amount screen.
 *  4. Confirm amount → calls onAdd(foodResult | manualInput, amount).
 *
 * The caller (MealIngredientEditor) handles promoteFoodFromResult +
 * createManualFood + addMealIngredient so this component stays display-only.
 */

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { rebirthJsonHeaders } from '@/lib/api/headers';
import type { FoodResult } from '@/lib/nutrition-history-types';

export interface ManualFoodDraft {
  name: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
}

interface SearchResponse {
  layer1: FoodResult[];
  layer2: FoodResult[];
  layer3: FoodResult[];
  combined: FoodResult[];
}

export interface AddIngredientResult {
  /** Set when user picked a search result. */
  searchResult?: FoodResult;
  /** Set when user typed in manually. */
  manual?: ManualFoodDraft;
  /** Amount in the food's per_unit (e.g. 80 for 80g). */
  amount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called once the user confirms food + amount. */
  onAdd: (result: AddIngredientResult) => Promise<void> | void;
}

type Stage = 'search' | 'amount' | 'manual';

export function AddIngredientSheet({ open, onClose, onAdd }: Props) {
  const [stage, setStage] = useState<Stage>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FoodResult | null>(null);
  const [manual, setManual] = useState<ManualFoodDraft>({
    name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '',
  });
  const [amountStr, setAmountStr] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset when sheet opens/closes
  useEffect(() => {
    if (open) {
      setStage('search');
      setQuery('');
      setResults([]);
      setSelected(null);
      setManual({ name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
      setAmountStr('');
      setSaving(false);
    }
  }, [open]);

  // Run search when query changes
  useEffect(() => {
    if (!open || stage !== 'search') return;
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
    return () => { cancelled = true; };
  }, [query, open, stage]);

  function pickSearchResult(result: FoodResult) {
    setSelected(result);
    // Pre-fill amount with the food's natural serving qty (or 1 for serve-unit)
    const defaultAmt = result.serving_size?.qty
      ? String(result.serving_size.qty)
      : '1';
    setAmountStr(defaultAmt);
    setStage('amount');
  }

  function goToManualAmount() {
    // Pre-fill name from query if not already set
    setManual(m => ({ ...m, name: m.name || query.trim() }));
    setStage('manual');
  }

  function unitLabel(): string {
    if (selected?.serving_size?.unit) {
      const u = selected.serving_size.unit.toLowerCase();
      if (u === 'g' || u === 'gram' || u === 'grams') return 'g';
      if (u === 'ml' || u.startsWith('millil')) return 'ml';
      return u;
    }
    return 'serve';
  }

  async function handleConfirmAmount() {
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    try {
      if (selected) {
        await onAdd({ searchResult: selected, amount });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmManual() {
    if (!manual.name.trim()) return;
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    try {
      await onAdd({ manual, amount });
    } finally {
      setSaving(false);
    }
  }

  // ── Amount confirmation screen (search result) ────────────────────────────
  if (stage === 'amount' && selected) {
    const unit = unitLabel();
    const amountNum = parseFloat(amountStr);
    const valid = Number.isFinite(amountNum) && amountNum > 0;
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Add ingredient"
        testId="m-sheet-addingredient"
        height="auto"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStage('search')} className="flex-1">
              Back
            </Button>
            <Button onClick={handleConfirmAmount} disabled={!valid || saving} className="flex-1">
              {saving ? 'Adding…' : 'Add'}
            </Button>
          </div>
        }
      >
        <div className="p-4 space-y-4">
          <div className="text-sm font-medium truncate">{selected.food_name}</div>

          {/* Macro preview row */}
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <MacroChip label="Cal" value={selected.calories} />
            <MacroChip label="Pro" value={selected.protein_g} unit="g" />
            <MacroChip label="Carb" value={selected.carbs_g} unit="g" />
            <MacroChip label="Fat" value={selected.fat_g} unit="g" />
          </div>

          {/* Amount input */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Amount</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0"
                autoFocus
                className="flex-1 h-11 px-3 rounded-xl bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
              />
              <span className="text-sm text-muted-foreground w-10 text-left">{unit}</span>
            </div>
          </div>
        </div>
      </Sheet>
    );
  }

  // ── Manual entry screen ───────────────────────────────────────────────────
  if (stage === 'manual') {
    const amountNum = parseFloat(amountStr);
    const amountValid = Number.isFinite(amountNum) && amountNum > 0;
    const nameValid = manual.name.trim().length > 0;
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Add manually"
        testId="m-sheet-addingredient-manual"
        height="auto"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStage('search')} className="flex-1">
              Back
            </Button>
            <Button onClick={handleConfirmManual} disabled={!nameValid || !amountValid || saving} className="flex-1">
              {saving ? 'Adding…' : 'Add'}
            </Button>
          </div>
        }
      >
        <div className="p-4 space-y-3">
          <input
            value={manual.name}
            onChange={(e) => setManual(m => ({ ...m, name: e.target.value }))}
            placeholder="Food name"
            autoFocus
            className="w-full h-11 px-3 rounded-xl bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <div className="grid grid-cols-4 gap-2">
            <ManualField label="Cal" value={manual.calories} onChange={v => setManual(m => ({ ...m, calories: v }))} />
            <ManualField label="Pro" value={manual.protein_g} onChange={v => setManual(m => ({ ...m, protein_g: v }))} />
            <ManualField label="Carb" value={manual.carbs_g} onChange={v => setManual(m => ({ ...m, carbs_g: v }))} />
            <ManualField label="Fat" value={manual.fat_g} onChange={v => setManual(m => ({ ...m, fat_g: v }))} />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Amount (serves)</div>
            <input
              type="number"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="1"
              className="w-full h-11 px-3 rounded-xl bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
            />
          </div>
        </div>
      </Sheet>
    );
  }

  // ── Search screen (default) ───────────────────────────────────────────────
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add ingredient"
      testId="m-sheet-addingredient"
      height="90vh"
    >
      <div className="p-4 space-y-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search foods…"
          autoFocus
        />

        {loading && (
          <div className="text-xs text-muted-foreground py-1">Searching…</div>
        )}

        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="space-y-3 py-2">
            <div className="text-sm text-muted-foreground">No matches for &ldquo;{query.trim()}&rdquo;.</div>
            <Button
              variant="secondary"
              onClick={goToManualAmount}
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
                  onClick={() => pickSearchResult(r)}
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
                  <div className="text-sm tabular-nums shrink-0">
                    {r.calories != null ? `${Math.round(r.calories)} kcal` : '—'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Always-visible manual add section */}
        <div className="pt-3 border-t border-border/40">
          <button
            type="button"
            onClick={goToManualAmount}
            className="text-xs text-primary hover:underline"
          >
            Add manually instead
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function MacroChip({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/40 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">
        {value != null ? Math.round(value) : '—'}
        {value != null && unit ? (
          <span className="text-[10px] text-muted-foreground">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

function ManualField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
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
