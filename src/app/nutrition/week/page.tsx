'use client';

import { useState } from 'react';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { dateToDayOfWeek } from '@/lib/api/nutrition';
import { useWeekMeals } from '@/lib/useLocalDB-nutrition';
import { setWeekMeal, deleteWeekMeal } from '@/lib/mutations-nutrition';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface WeekMealForm {
  meal_name: string;
  meal_slot: string;
  protein_g: string;
  calories: string;
  quality_rating: string;
}

const EMPTY_FORM: WeekMealForm = {
  meal_name: '',
  meal_slot: '',
  protein_g: '',
  calories: '',
  quality_rating: '',
};

/**
 * Standard Week template editor. Users build up a typical-week meal plan
 * (one row per slot per day) that the Today page can later use as a
 * planned-meal source. Daily macro logging happens at /nutrition/today.
 *
 * Reads/writes via Dexie (local-first); the sync engine pushes/pulls to
 * Postgres in the background. Earlier versions hit /api/nutrition/week
 * directly, which silently 401'd on the Capacitor iOS build (no
 * NEXT_PUBLIC_REBIRTH_API_KEY baked in) and made the whole page render
 * empty even though Postgres + Dexie had the rows.
 */
export default function NutritionWeekPage() {
  const [weekDay, setWeekDay] = useState(() => dateToDayOfWeek(new Date().toISOString().slice(0, 10)));

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<WeekMealForm>(EMPTY_FORM);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<WeekMealForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const allWeekMeals = useWeekMeals();
  const dayMeals = allWeekMeals.filter((m) => m.day_of_week === weekDay);

  async function addMeal(form: WeekMealForm) {
    setSaving(true);
    try {
      await setWeekMeal({
        day_of_week: weekDay,
        meal_slot: form.meal_slot || '',
        meal_name: form.meal_name,
        protein_g: form.protein_g ? parseFloat(form.protein_g) : null,
        calories: form.calories ? parseFloat(form.calories) : null,
        quality_rating: form.quality_rating ? parseInt(form.quality_rating, 10) : null,
        sort_order: dayMeals.length,
      });
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function editMeal(uuid: string, form: WeekMealForm) {
    const existing = dayMeals.find((m) => m.uuid === uuid);
    if (!existing) return;
    setSaving(true);
    try {
      await setWeekMeal({
        uuid,
        day_of_week: existing.day_of_week,
        meal_slot: form.meal_slot,
        meal_name: form.meal_name,
        protein_g: form.protein_g ? parseFloat(form.protein_g) : null,
        carbs_g: existing.carbs_g,
        fat_g: existing.fat_g,
        calories: form.calories ? parseFloat(form.calories) : null,
        quality_rating: form.quality_rating ? parseInt(form.quality_rating, 10) : null,
        sort_order: existing.sort_order,
      });
      setEditingUuid(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="tab-content bg-background">
      <header className="px-4 pt-safe pb-3 flex items-center gap-3">
        <Link href="/settings" className="text-primary p-1 -ml-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Standard Week</h1>
      </header>

      <div className="pb-8">
        {/* Day selector */}
        <div className="px-4 mb-4">
          <div className="flex gap-1">
            {DAY_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
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
          {dayMeals.length > 0 && (
            <div className="ios-section">
              {dayMeals.map((meal, i) => {
                const isEditing = editingUuid === meal.uuid;
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
                            type="button"
                            onClick={() => {
                              setEditingUuid(meal.uuid);
                              setEditForm({
                                meal_name: meal.meal_name,
                                meal_slot: meal.meal_slot,
                                protein_g: String(meal.protein_g ?? ''),
                                calories: String(meal.calories ?? ''),
                                quality_rating: String(meal.quality_rating ?? ''),
                              });
                            }}
                            className="p-2 text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                            aria-label="Edit meal"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteWeekMeal(meal.uuid)}
                            className="p-2 text-red-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
                            aria-label="Delete meal"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <MealEditFields
                        form={editForm}
                        onChange={setEditForm}
                        onSave={() => editMeal(meal.uuid, editForm)}
                        onCancel={() => setEditingUuid(null)}
                        saving={saving}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {dayMeals.length === 0 && !showAddForm && (
            <p className="text-xs text-muted-foreground px-1">No meals defined for {DAY_LABELS[weekDay]}.</p>
          )}

          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
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
                <MealAddFields
                  form={addForm}
                  onChange={setAddForm}
                  onCancel={() => {
                    setShowAddForm(false);
                    setAddForm(EMPTY_FORM);
                  }}
                  onSave={() => addMeal(addForm)}
                  saving={saving}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

interface FieldsProps {
  form: WeekMealForm;
  onChange: (f: WeekMealForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function MealEditFields({ form, onChange, onSave, onCancel, saving }: FieldsProps) {
  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder="Meal name"
        value={form.meal_name}
        onChange={(e) => onChange({ ...form, meal_name: e.target.value })}
        className="w-full bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
      />
      <input
        type="text"
        placeholder="Slot (e.g. breakfast)"
        value={form.meal_slot}
        onChange={(e) => onChange({ ...form, meal_slot: e.target.value })}
        className="w-full bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
      />
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          placeholder="Protein (g)"
          value={form.protein_g}
          onChange={(e) => onChange({ ...form, protein_g: e.target.value })}
          className="flex-1 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Calories"
          value={form.calories}
          onChange={(e) => onChange({ ...form, calories: e.target.value })}
          className="flex-1 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="Quality (1-5)"
          value={form.quality_rating}
          min={1}
          max={5}
          onChange={(e) => onChange({ ...form, quality_rating: e.target.value })}
          className="w-24 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[36px]"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function MealAddFields({ form, onChange, onSave, onCancel, saving }: FieldsProps) {
  return (
    <>
      <div className="ios-row">
        <input
          type="text"
          placeholder="Meal name"
          value={form.meal_name}
          onChange={(e) => onChange({ ...form, meal_name: e.target.value })}
          className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
        />
      </div>
      <div className="ios-row">
        <input
          type="text"
          placeholder="Slot (e.g. breakfast, snack 1)"
          value={form.meal_slot}
          onChange={(e) => onChange({ ...form, meal_slot: e.target.value })}
          className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
        />
      </div>
      <div className="ios-row gap-3 flex-wrap">
        <input
          type="number"
          inputMode="decimal"
          placeholder="Protein (g)"
          value={form.protein_g}
          onChange={(e) => onChange({ ...form, protein_g: e.target.value })}
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none min-h-[44px]"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Calories"
          value={form.calories}
          onChange={(e) => onChange({ ...form, calories: e.target.value })}
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none min-h-[44px]"
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="Quality (1-5)"
          value={form.quality_rating}
          min={1}
          max={5}
          onChange={(e) => onChange({ ...form, quality_rating: e.target.value })}
          className="w-28 bg-transparent text-sm outline-none min-h-[44px]"
        />
      </div>
      <div className="ios-row justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !form.meal_name}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Add'}
        </button>
      </div>
    </>
  );
}
