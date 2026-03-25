'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import type { NutritionLog, NutritionWeekMeal, NutritionDayNote } from '@/types';

// ── helpers ────────────────────────────────────────────────────────────────

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function formatDateLabel(dateStr: string): string {
  const today = toDateStr(new Date());
  const yesterday = offsetDate(today, -1);
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

/** Convert YYYY-MM-DD date string to day_of_week (0=Mon … 6=Sun) */
function dateToDayOfWeek(dateStr: string): number {
  const jsDay = new Date(dateStr + 'T12:00:00').getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── types ──────────────────────────────────────────────────────────────────

interface AddMealForm {
  meal_name: string;
  protein_g: string;
  calories: string;
  notes: string;
}

const EMPTY_FORM: AddMealForm = { meal_name: '', protein_g: '', calories: '', notes: '' };

// ── component ──────────────────────────────────────────────────────────────

export default function NutritionPage() {
  const [activeTab, setActiveTab] = useState<'today' | 'week'>('today');

  // ── Today tab state ──────────────────────────────────────────────────────
  const [viewDate, setViewDate] = useState(() => toDateStr(new Date()));
  const [templateMeals, setTemplateMeals] = useState<NutritionWeekMeal[]>([]);
  const [loggedMeals, setLoggedMeals] = useState<NutritionLog[]>([]);
  const [_dayNote, setDayNote] = useState<NutritionDayNote | null>(null);
  const [loadingDay, setLoadingDay] = useState(true);

  // Add-meal form (unplanned)
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddMealForm>(EMPTY_FORM);
  const [addingSave, setAddingSave] = useState(false);

  // Deviation edit state: keyed by template meal uuid
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [deviationForm, setDeviationForm] = useState<AddMealForm>(EMPTY_FORM);

  // End-of-day summary edits
  const [hydrationInput, setHydrationInput] = useState('');
  const [dayNoteInput, setDayNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Protein target from localStorage
  const [proteinTarget, setProteinTarget] = useState(180);

  // ── Standard Week tab state ───────────────────────────────────────────────
  const [weekDay, setWeekDay] = useState(() => dateToDayOfWeek(toDateStr(new Date())));
  const [allWeekMeals, setAllWeekMeals] = useState<NutritionWeekMeal[]>([]);
  const [loadingWeek, setLoadingWeek] = useState(true);

  // Add template meal form
  const [showWeekAddForm, setShowWeekAddForm] = useState(false);
  const [weekAddForm, setWeekAddForm] = useState({ meal_name: '', protein_g: '', calories: '', quality_rating: '', meal_slot: '' });
  const [weekAddSaving, setWeekAddSaving] = useState(false);

  // Edit template meal
  const [editingWeekMeal, setEditingWeekMeal] = useState<string | null>(null);
  const [weekEditForm, setWeekEditForm] = useState({ meal_name: '', protein_g: '', calories: '', quality_rating: '', meal_slot: '' });

  // ── load protein target ───────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('iron-nutrition-protein-target');
    if (saved) setProteinTarget(parseInt(saved, 10));
  }, []);

  // ── load today tab data ───────────────────────────────────────────────────
  const loadDayData = useCallback(async (date: string) => {
    setLoadingDay(true);
    const h = apiHeaders();
    const dow = dateToDayOfWeek(date);
    const [tmRes, logRes, noteRes] = await Promise.all([
      fetch(`/api/nutrition/week?day=${dow}`, { headers: h }),
      fetch(`/api/nutrition?from=${date}&to=${date}&limit=100`, { headers: h }),
      fetch(`/api/nutrition/day-notes?date=${date}`, { headers: h }),
    ]);
    if (tmRes.ok) setTemplateMeals(await tmRes.json());
    if (logRes.ok) setLoggedMeals(await logRes.json());
    const noteData = noteRes.ok ? await noteRes.json() : null;
    setDayNote(noteData);
    setHydrationInput(noteData?.hydration_ml != null ? String(noteData.hydration_ml) : '');
    setDayNoteInput(noteData?.notes ?? '');
    setLoadingDay(false);
  }, []);

  useEffect(() => { loadDayData(viewDate); }, [viewDate, loadDayData]);

  // ── load week tab data ────────────────────────────────────────────────────
  const loadWeekMeals = useCallback(async () => {
    setLoadingWeek(true);
    const res = await fetch('/api/nutrition/week', { headers: apiHeaders() });
    if (res.ok) setAllWeekMeals(await res.json());
    setLoadingWeek(false);
  }, []);

  useEffect(() => { loadWeekMeals(); }, [loadWeekMeals]);

  // ── derived ───────────────────────────────────────────────────────────────
  const dayMeals = allWeekMeals.filter(m => m.day_of_week === weekDay);

  // Map template_meal_id → logged meal for quick lookup
  const logsByTemplate = new Map<string, NutritionLog>();
  for (const l of loggedMeals) {
    if (l.template_meal_id) logsByTemplate.set(l.template_meal_id, l);
  }
  const unplannedLogs = loggedMeals.filter(l => l.status === 'added');

  const totalProtein = loggedMeals.reduce((s, l) => s + (l.protein_g ?? 0), 0);
  const totalCalories = loggedMeals.reduce((s, l) => s + (l.calories ?? 0), 0);

  // ── handlers: Today tab ───────────────────────────────────────────────────

  async function logAsPlanned(meal: NutritionWeekMeal) {
    const today = toDateStr(new Date());
    const loggedAt = viewDate === today
      ? new Date().toISOString()
      : viewDate + 'T12:00:00.000Z';
    const res = await fetch('/api/nutrition', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        logged_at: loggedAt,
        meal_name: meal.meal_name,
        template_meal_id: meal.uuid,
        protein_g: meal.protein_g,
        calories: meal.calories,
        status: 'planned',
      }),
    });
    if (res.ok) {
      const log: NutritionLog = await res.json();
      setLoggedMeals(prev => [...prev, log]);
    }
  }

  async function logDeviation(meal: NutritionWeekMeal) {
    if (!deviationForm.meal_name && !deviationForm.protein_g && !deviationForm.calories) return;
    const today = toDateStr(new Date());
    const loggedAt = viewDate === today
      ? new Date().toISOString()
      : viewDate + 'T12:00:00.000Z';
    const res = await fetch('/api/nutrition', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        logged_at: loggedAt,
        meal_name: deviationForm.meal_name || meal.meal_name,
        template_meal_id: meal.uuid,
        protein_g: deviationForm.protein_g ? parseFloat(deviationForm.protein_g) : null,
        calories: deviationForm.calories ? parseFloat(deviationForm.calories) : null,
        notes: deviationForm.notes || null,
        status: 'deviation',
      }),
    });
    if (res.ok) {
      const log: NutritionLog = await res.json();
      setLoggedMeals(prev => [...prev, log]);
      setEditingTemplate(null);
      setDeviationForm(EMPTY_FORM);
    }
  }

  async function removeLog(uuid: string) {
    await fetch(`/api/nutrition/${uuid}`, { method: 'DELETE', headers: apiHeaders() });
    setLoggedMeals(prev => prev.filter(l => l.uuid !== uuid));
  }

  async function saveAddForm() {
    if (!addForm.meal_name) return;
    setAddingSave(true);
    const today = toDateStr(new Date());
    const loggedAt = viewDate === today
      ? new Date().toISOString()
      : viewDate + 'T12:00:00.000Z';
    try {
      const res = await fetch('/api/nutrition', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          logged_at: loggedAt,
          meal_name: addForm.meal_name,
          protein_g: addForm.protein_g ? parseFloat(addForm.protein_g) : null,
          calories: addForm.calories ? parseFloat(addForm.calories) : null,
          notes: addForm.notes || null,
          status: 'added',
        }),
      });
      if (res.ok) {
        const log: NutritionLog = await res.json();
        setLoggedMeals(prev => [...prev, log]);
        setAddForm(EMPTY_FORM);
        setShowAddForm(false);
      }
    } finally {
      setAddingSave(false);
    }
  }

  async function saveDayNote() {
    setSavingNote(true);
    try {
      const res = await fetch('/api/nutrition/day-notes', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          date: viewDate,
          hydration_ml: hydrationInput ? parseInt(hydrationInput, 10) : null,
          notes: dayNoteInput || null,
        }),
      });
      if (res.ok) setDayNote(await res.json());
    } finally {
      setSavingNote(false);
    }
  }

  // ── handlers: Standard Week tab ───────────────────────────────────────────

  async function saveWeekMeal() {
    if (!weekAddForm.meal_name) return;
    setWeekAddSaving(true);
    try {
      const res = await fetch('/api/nutrition/week', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          day_of_week: weekDay,
          meal_slot: weekAddForm.meal_slot || '',
          meal_name: weekAddForm.meal_name,
          protein_g: weekAddForm.protein_g ? parseFloat(weekAddForm.protein_g) : null,
          calories: weekAddForm.calories ? parseFloat(weekAddForm.calories) : null,
          quality_rating: weekAddForm.quality_rating ? parseInt(weekAddForm.quality_rating, 10) : null,
          sort_order: dayMeals.length,
        }),
      });
      if (res.ok) {
        const meal: NutritionWeekMeal = await res.json();
        setAllWeekMeals(prev => [...prev, meal]);
        setWeekAddForm({ meal_name: '', protein_g: '', calories: '', quality_rating: '', meal_slot: '' });
        setShowWeekAddForm(false);
      }
    } finally {
      setWeekAddSaving(false);
    }
  }

  async function saveWeekEdit(uuid: string) {
    const res = await fetch(`/api/nutrition/week/${uuid}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({
        meal_name: weekEditForm.meal_name,
        meal_slot: weekEditForm.meal_slot,
        protein_g: weekEditForm.protein_g ? parseFloat(weekEditForm.protein_g) : null,
        calories: weekEditForm.calories ? parseFloat(weekEditForm.calories) : null,
        quality_rating: weekEditForm.quality_rating ? parseInt(weekEditForm.quality_rating, 10) : null,
      }),
    });
    if (res.ok) {
      const updated: NutritionWeekMeal = await res.json();
      setAllWeekMeals(prev => prev.map(m => m.uuid === uuid ? updated : m));
      setEditingWeekMeal(null);
    }
  }

  async function deleteWeekMeal(uuid: string) {
    await fetch(`/api/nutrition/week/${uuid}`, { method: 'DELETE', headers: apiHeaders() });
    setAllWeekMeals(prev => prev.filter(m => m.uuid !== uuid));
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <main className="tab-content bg-background">
      {/* Header */}
      <div className="px-4 pt-14 pb-2 flex items-center gap-3">
        <Link href="/settings" className="text-primary p-1 -ml-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Nutrition</h1>
      </div>

      {/* Tab switcher */}
      <div className="px-4 pb-3">
        <div className="flex rounded-lg overflow-hidden border border-border">
          {(['today', 'week'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium transition-colors capitalize ${
                activeTab === tab ? 'bg-primary text-white' : 'text-foreground'
              }`}
            >
              {tab === 'today' ? 'Today' : 'Standard Week'}
            </button>
          ))}
        </div>
      </div>

      {/* ── TODAY TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'today' && (
        <div className="px-4 space-y-4 pb-8">
          {/* Date navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setViewDate(d => offsetDate(d, -1))}
              className="p-2 text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-base font-semibold">{formatDateLabel(viewDate)}</span>
            <button
              onClick={() => setViewDate(d => offsetDate(d, 1))}
              className="p-2 text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {loadingDay ? (
            <p className="text-xs text-muted-foreground px-1">Loading…</p>
          ) : (
            <>
              {/* Template meals */}
              {templateMeals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Planned meals</p>
                  <div className="ios-section">
                    {templateMeals.map((meal, i) => {
                      const logged = logsByTemplate.get(meal.uuid);
                      const isEditing = editingTemplate === meal.uuid;
                      return (
                        <div
                          key={meal.uuid}
                          className={`flex flex-col gap-1 py-3 px-4 ${i < templateMeals.length - 1 ? 'border-b border-border' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-medium ${logged ? 'text-muted-foreground line-through' : ''}`}>
                                {meal.meal_name}
                              </span>
                              <div className="flex gap-3 mt-0.5">
                                {meal.protein_g != null && (
                                  <span className="text-xs text-muted-foreground">{meal.protein_g}g protein</span>
                                )}
                                {meal.calories != null && (
                                  <span className="text-xs text-muted-foreground">{meal.calories} kcal</span>
                                )}
                              </div>
                            </div>
                            {logged ? (
                              <div className="flex items-center gap-2">
                                {logged.status === 'deviation' && (
                                  <span className="text-xs text-orange-500 font-medium">deviation</span>
                                )}
                                <span className="text-xs text-green-600 font-semibold">✓</span>
                                <button
                                  onClick={() => removeLog(logged.uuid)}
                                  className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => logAsPlanned(meal)}
                                  className="p-2 text-green-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                  title="Log as planned"
                                >
                                  <Check className="h-5 w-5" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (isEditing) {
                                      setEditingTemplate(null);
                                    } else {
                                      setEditingTemplate(meal.uuid);
                                      setDeviationForm({ meal_name: meal.meal_name, protein_g: String(meal.protein_g ?? ''), calories: String(meal.calories ?? ''), notes: '' });
                                    }
                                  }}
                                  className="p-2 text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                                  title="Log deviation"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Deviation form */}
                          {isEditing && !logged && (
                            <div className="mt-1 space-y-2 bg-secondary/40 rounded-lg p-3">
                              <p className="text-xs font-medium text-muted-foreground">Log deviation</p>
                              <input
                                type="text"
                                placeholder="Meal name"
                                value={deviationForm.meal_name}
                                onChange={e => setDeviationForm(f => ({ ...f, meal_name: e.target.value }))}
                                className="w-full bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                              />
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder="Protein (g)"
                                  value={deviationForm.protein_g}
                                  onChange={e => setDeviationForm(f => ({ ...f, protein_g: e.target.value }))}
                                  className="flex-1 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                                />
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder="Calories"
                                  value={deviationForm.calories}
                                  onChange={e => setDeviationForm(f => ({ ...f, calories: e.target.value }))}
                                  className="flex-1 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                                />
                              </div>
                              <input
                                type="text"
                                placeholder="Notes (optional)"
                                value={deviationForm.notes}
                                onChange={e => setDeviationForm(f => ({ ...f, notes: e.target.value }))}
                                className="w-full bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                              />
                              <div className="flex justify-end gap-2 pt-1">
                                <button
                                  onClick={() => setEditingTemplate(null)}
                                  className="px-3 py-1.5 text-sm text-muted-foreground"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => logDeviation(meal)}
                                  className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Show logged deviation details */}
                          {logged && logged.status === 'deviation' && (
                            <div className="flex gap-3 mt-0.5 pl-0">
                              {logged.meal_name && (
                                <span className="text-xs text-foreground">{logged.meal_name}</span>
                              )}
                              {logged.protein_g != null && (
                                <span className="text-xs text-muted-foreground">{logged.protein_g}g protein</span>
                              )}
                              {logged.calories != null && (
                                <span className="text-xs text-muted-foreground">{logged.calories} kcal</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Unplanned logged meals */}
              {unplannedLogs.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Added meals</p>
                  <div className="ios-section">
                    {unplannedLogs.map((log, i) => (
                      <div
                        key={log.uuid}
                        className={`ios-row justify-between ${i < unplannedLogs.length - 1 ? 'border-b border-border' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{log.meal_name ?? 'Meal'}</span>
                          <div className="flex gap-3 mt-0.5">
                            {log.protein_g != null && (
                              <span className="text-xs text-muted-foreground">{log.protein_g}g protein</span>
                            )}
                            {log.calories != null && (
                              <span className="text-xs text-muted-foreground">{log.calories} kcal</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => removeLog(log.uuid)}
                          className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {templateMeals.length === 0 && loggedMeals.length === 0 && (
                <p className="text-xs text-muted-foreground px-1">
                  No meals planned for this day.{' '}
                  <button
                    onClick={() => setActiveTab('week')}
                    className="text-primary underline"
                  >
                    Set up Standard Week
                  </button>
                </p>
              )}

              {/* Add unplanned meal */}
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-2 text-primary text-sm font-medium px-1 min-h-[44px]"
                >
                  <Plus className="h-4 w-4" />
                  Add meal
                </button>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Add meal</p>
                  <div className="ios-section">
                    <div className="ios-row">
                      <input
                        type="text"
                        placeholder="Meal name"
                        value={addForm.meal_name}
                        onChange={e => setAddForm(f => ({ ...f, meal_name: e.target.value }))}
                        className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                      />
                    </div>
                    <div className="ios-row gap-3">
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="Protein (g)"
                        value={addForm.protein_g}
                        onChange={e => setAddForm(f => ({ ...f, protein_g: e.target.value }))}
                        className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="Calories"
                        value={addForm.calories}
                        onChange={e => setAddForm(f => ({ ...f, calories: e.target.value }))}
                        className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                      />
                    </div>
                    <div className="ios-row">
                      <input
                        type="text"
                        placeholder="Notes (optional)"
                        value={addForm.notes}
                        onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                        className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                      />
                    </div>
                    <div className="ios-row justify-end gap-2">
                      <button
                        onClick={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
                        className="px-3 py-1.5 text-sm text-muted-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveAddForm}
                        disabled={addingSave || !addForm.meal_name}
                        className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
                      >
                        {addingSave ? 'Saving…' : 'Add'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* End-of-day summary */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Daily summary</p>
                <div className="ios-section">
                  {/* Protein progress */}
                  <div className="ios-row justify-between">
                    <span className="text-sm font-medium">Protein</span>
                    <span className={`text-sm font-semibold ${totalProtein >= proteinTarget ? 'text-green-600' : 'text-foreground'}`}>
                      {Math.round(totalProtein)}
                      <span className="text-xs font-normal text-muted-foreground"> / {proteinTarget}g</span>
                    </span>
                  </div>
                  {/* Calories */}
                  {totalCalories > 0 && (
                    <div className="ios-row justify-between">
                      <span className="text-sm font-medium">Calories</span>
                      <span className="text-sm text-muted-foreground">{Math.round(totalCalories)} kcal</span>
                    </div>
                  )}
                  {/* Protein target edit */}
                  <div className="ios-row justify-between">
                    <span className="text-sm text-muted-foreground">Protein target</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={proteinTarget}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (v > 0) {
                          setProteinTarget(v);
                          localStorage.setItem('iron-nutrition-protein-target', String(v));
                        }
                      }}
                      className="w-16 bg-transparent text-sm text-right outline-none text-muted-foreground"
                    />
                  </div>
                  {/* Hydration */}
                  <div className="ios-row justify-between gap-3">
                    <span className="text-sm font-medium">Hydration (ml)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="0"
                      value={hydrationInput}
                      onChange={e => setHydrationInput(e.target.value)}
                      className="w-20 bg-transparent text-sm text-right outline-none"
                    />
                  </div>
                  {/* Notes */}
                  <div className="ios-row">
                    <input
                      type="text"
                      placeholder="Day notes (optional)"
                      value={dayNoteInput}
                      onChange={e => setDayNoteInput(e.target.value)}
                      className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                    />
                  </div>
                  <div className="ios-row justify-end">
                    <button
                      onClick={saveDayNote}
                      disabled={savingNote}
                      className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
                    >
                      {savingNote ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STANDARD WEEK TAB ─────────────────────────────────────────────── */}
      {activeTab === 'week' && (
        <div className="pb-8">
          {/* Day selector */}
          <div className="px-4 mb-4">
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => setWeekDay(i)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                    weekDay === i ? 'bg-primary text-white' : 'bg-secondary text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 space-y-4">
            {loadingWeek ? (
              <p className="text-xs text-muted-foreground px-1">Loading…</p>
            ) : (
              <>
                {/* Meal list for selected day */}
                {dayMeals.length > 0 && (
                  <div className="ios-section">
                    {dayMeals.map((meal, i) => {
                      const isEditing = editingWeekMeal === meal.uuid;
                      return (
                        <div
                          key={meal.uuid}
                          className={`flex flex-col gap-1 py-3 px-4 ${i < dayMeals.length - 1 ? 'border-b border-border' : ''}`}
                        >
                          {!isEditing ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">{meal.meal_name}</span>
                                {meal.meal_slot && (
                                  <span className="ml-2 text-xs text-muted-foreground">{meal.meal_slot}</span>
                                )}
                                <div className="flex gap-3 mt-0.5">
                                  {meal.protein_g != null && (
                                    <span className="text-xs text-muted-foreground">{meal.protein_g}g protein</span>
                                  )}
                                  {meal.calories != null && (
                                    <span className="text-xs text-muted-foreground">{meal.calories} kcal</span>
                                  )}
                                  {meal.quality_rating != null && (
                                    <span className="text-xs text-muted-foreground">★ {meal.quality_rating}/5</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-0">
                                <button
                                  onClick={() => {
                                    setEditingWeekMeal(meal.uuid);
                                    setWeekEditForm({
                                      meal_name: meal.meal_name,
                                      meal_slot: meal.meal_slot,
                                      protein_g: String(meal.protein_g ?? ''),
                                      calories: String(meal.calories ?? ''),
                                      quality_rating: String(meal.quality_rating ?? ''),
                                    });
                                  }}
                                  className="p-2 text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => deleteWeekMeal(meal.uuid)}
                                  className="p-2 text-red-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <input
                                type="text"
                                placeholder="Meal name"
                                value={weekEditForm.meal_name}
                                onChange={e => setWeekEditForm(f => ({ ...f, meal_name: e.target.value }))}
                                className="w-full bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                              />
                              <input
                                type="text"
                                placeholder="Slot (e.g. breakfast)"
                                value={weekEditForm.meal_slot}
                                onChange={e => setWeekEditForm(f => ({ ...f, meal_slot: e.target.value }))}
                                className="w-full bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                              />
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder="Protein (g)"
                                  value={weekEditForm.protein_g}
                                  onChange={e => setWeekEditForm(f => ({ ...f, protein_g: e.target.value }))}
                                  className="flex-1 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                                />
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder="Calories"
                                  value={weekEditForm.calories}
                                  onChange={e => setWeekEditForm(f => ({ ...f, calories: e.target.value }))}
                                  className="flex-1 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                                />
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  placeholder="Quality (1-5)"
                                  value={weekEditForm.quality_rating}
                                  min={1}
                                  max={5}
                                  onChange={e => setWeekEditForm(f => ({ ...f, quality_rating: e.target.value }))}
                                  className="w-24 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
                                />
                              </div>
                              <div className="flex justify-end gap-2 pt-1">
                                <button
                                  onClick={() => setEditingWeekMeal(null)}
                                  className="px-3 py-1.5 text-sm text-muted-foreground"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => saveWeekEdit(meal.uuid)}
                                  className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {dayMeals.length === 0 && !showWeekAddForm && (
                  <p className="text-xs text-muted-foreground px-1">No meals defined for {DAY_LABELS[weekDay]}.</p>
                )}

                {/* Add template meal form */}
                {!showWeekAddForm ? (
                  <button
                    onClick={() => setShowWeekAddForm(true)}
                    className="flex items-center gap-2 text-primary text-sm font-medium px-1 min-h-[44px]"
                  >
                    <Plus className="h-4 w-4" />
                    Add meal for {DAY_LABELS[weekDay]}
                  </button>
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                      New meal — {DAY_LABELS[weekDay]}
                    </p>
                    <div className="ios-section">
                      <div className="ios-row">
                        <input
                          type="text"
                          placeholder="Meal name"
                          value={weekAddForm.meal_name}
                          onChange={e => setWeekAddForm(f => ({ ...f, meal_name: e.target.value }))}
                          className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                        />
                      </div>
                      <div className="ios-row">
                        <input
                          type="text"
                          placeholder="Slot (e.g. breakfast, snack 1)"
                          value={weekAddForm.meal_slot}
                          onChange={e => setWeekAddForm(f => ({ ...f, meal_slot: e.target.value }))}
                          className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                        />
                      </div>
                      <div className="ios-row gap-3 flex-wrap">
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="Protein (g)"
                          value={weekAddForm.protein_g}
                          onChange={e => setWeekAddForm(f => ({ ...f, protein_g: e.target.value }))}
                          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none min-h-[44px]"
                        />
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="Calories"
                          value={weekAddForm.calories}
                          onChange={e => setWeekAddForm(f => ({ ...f, calories: e.target.value }))}
                          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none min-h-[44px]"
                        />
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="Quality (1-5)"
                          value={weekAddForm.quality_rating}
                          min={1}
                          max={5}
                          onChange={e => setWeekAddForm(f => ({ ...f, quality_rating: e.target.value }))}
                          className="w-28 bg-transparent text-sm outline-none min-h-[44px]"
                        />
                      </div>
                      <div className="ios-row justify-end gap-2">
                        <button
                          onClick={() => { setShowWeekAddForm(false); setWeekAddForm({ meal_name: '', protein_g: '', calories: '', quality_rating: '', meal_slot: '' }); }}
                          className="px-3 py-1.5 text-sm text-muted-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveWeekMeal}
                          disabled={weekAddSaving || !weekAddForm.meal_name}
                          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
                        >
                          {weekAddSaving ? 'Saving…' : 'Add'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
