'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { dateToDayOfWeek } from '@/lib/api/nutrition';
import { useWeekMeals } from '@/lib/useLocalDB-nutrition';
import { setWeekMeal, deleteWeekMeal } from '@/lib/mutations-nutrition';
import type { LocalNutritionWeekMeal } from '@/db/local';
import type { MealSlot } from '@/types';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

interface WeekMealForm {
  meal_name: string;
  protein_g: string;
  calories: string;
  quality_rating: string;
}

const EMPTY_FORM: WeekMealForm = {
  meal_name: '',
  protein_g: '',
  calories: '',
  quality_rating: '',
};

/**
 * Standard Week template editor. Users build up a typical-week meal plan
 * (one row per slot per day). The Today page materializes these rows into
 * actual nutrition_logs (status='planned') the first time each date is
 * opened — see ensurePlannedLogsForDate. Editing the template only affects
 * future dates; past dates already auto-filled stay frozen.
 */
export default function NutritionWeekPage() {
  const [weekDay, setWeekDay] = useState(() => dateToDayOfWeek(new Date().toISOString().slice(0, 10)));
  const [addingSlot, setAddingSlot] = useState<MealSlot | null>(null);
  const [addForm, setAddForm] = useState<WeekMealForm>(EMPTY_FORM);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<WeekMealForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const allWeekMeals = useWeekMeals();
  const dayMeals = useMemo(
    () => allWeekMeals.filter(m => m.day_of_week === weekDay),
    [allWeekMeals, weekDay],
  );

  const mealsBySlot = useMemo(() => {
    const map = new Map<MealSlot, LocalNutritionWeekMeal[]>();
    for (const slot of SLOTS) map.set(slot, []);
    for (const m of dayMeals) {
      const list = map.get(m.meal_slot);
      if (list) list.push(m);
    }
    return map;
  }, [dayMeals]);

  async function addMeal(slot: MealSlot, form: WeekMealForm) {
    setSaving(true);
    try {
      await setWeekMeal({
        day_of_week: weekDay,
        meal_slot: slot,
        meal_name: form.meal_name,
        protein_g: form.protein_g ? parseFloat(form.protein_g) : null,
        calories: form.calories ? parseFloat(form.calories) : null,
        quality_rating: form.quality_rating ? parseInt(form.quality_rating, 10) : null,
        sort_order: dayMeals.length,
      });
      setAddForm(EMPTY_FORM);
      setAddingSlot(null);
    } finally {
      setSaving(false);
    }
  }

  async function editMeal(uuid: string, form: WeekMealForm) {
    const existing = dayMeals.find(m => m.uuid === uuid);
    if (!existing) return;
    setSaving(true);
    try {
      await setWeekMeal({
        uuid,
        day_of_week: existing.day_of_week,
        meal_slot: existing.meal_slot,
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
        {/* Day-of-week selector */}
        <div className="px-4 mb-4">
          <div className="flex gap-1">
            {DAY_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setWeekDay(i);
                  setAddingSlot(null);
                  setEditingUuid(null);
                }}
                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                  weekDay === i ? 'bg-primary text-white' : 'bg-secondary text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 space-y-2">
          {SLOTS.map(slot => {
            const slotMeals = mealsBySlot.get(slot) ?? [];
            const isAdding = addingSlot === slot;
            return (
              <SlotSection
                key={slot}
                slot={slot}
                meals={slotMeals}
                isAdding={isAdding}
                addForm={addForm}
                editingUuid={editingUuid}
                editForm={editForm}
                saving={saving}
                onStartAdd={() => {
                  setAddingSlot(slot);
                  setAddForm(EMPTY_FORM);
                  setEditingUuid(null);
                }}
                onCancelAdd={() => {
                  setAddingSlot(null);
                  setAddForm(EMPTY_FORM);
                }}
                onSaveAdd={() => addMeal(slot, addForm)}
                onAddFormChange={setAddForm}
                onStartEdit={(meal) => {
                  setEditingUuid(meal.uuid);
                  setEditForm({
                    meal_name: meal.meal_name,
                    protein_g: String(meal.protein_g ?? ''),
                    calories: String(meal.calories ?? ''),
                    quality_rating: String(meal.quality_rating ?? ''),
                  });
                  setAddingSlot(null);
                }}
                onCancelEdit={() => setEditingUuid(null)}
                onSaveEdit={(uuid) => editMeal(uuid, editForm)}
                onEditFormChange={setEditForm}
                onDelete={(uuid) => deleteWeekMeal(uuid)}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}

interface SlotSectionProps {
  slot: MealSlot;
  meals: LocalNutritionWeekMeal[];
  isAdding: boolean;
  addForm: WeekMealForm;
  editingUuid: string | null;
  editForm: WeekMealForm;
  saving: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onSaveAdd: () => void;
  onAddFormChange: (f: WeekMealForm) => void;
  onStartEdit: (meal: LocalNutritionWeekMeal) => void;
  onCancelEdit: () => void;
  onSaveEdit: (uuid: string) => void;
  onEditFormChange: (f: WeekMealForm) => void;
  onDelete: (uuid: string) => void;
}

function SlotSection({
  slot, meals, isAdding, addForm, editingUuid, editForm, saving,
  onStartAdd, onCancelAdd, onSaveAdd, onAddFormChange,
  onStartEdit, onCancelEdit, onSaveEdit, onEditFormChange, onDelete,
}: SlotSectionProps) {
  const hasMeals = meals.length > 0;

  // Empty slot, not adding: thin add-prompt header (mirrors Today's MealSection).
  if (!hasMeals && !isAdding) {
    return (
      <button
        type="button"
        onClick={onStartAdd}
        className="w-full px-4 py-2.5 mt-3 flex items-center justify-between text-sm text-muted-foreground hover:bg-muted/40 rounded-lg transition-colors"
      >
        <span>{SLOT_LABELS[slot]}</span>
        <span className="flex items-center gap-1 text-xs">
          <Plus className="size-3.5" /> Add
        </span>
      </button>
    );
  }

  return (
    <section className="mt-3">
      <header className="flex items-center justify-between px-1 mb-1.5">
        <h3 className="text-sm font-semibold">{SLOT_LABELS[slot]}</h3>
      </header>
      <div className="ios-section">
        {meals.map((meal, i) => {
          const isEditing = editingUuid === meal.uuid;
          return (
            <div
              key={meal.uuid}
              className={`flex flex-col gap-1 py-3 px-4 ${i < meals.length - 1 ? 'border-b border-border' : ''}`}
            >
              {!isEditing ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{meal.meal_name}</span>
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
                      onClick={() => onStartEdit(meal)}
                      className="p-2 text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                      aria-label="Edit meal"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(meal.uuid)}
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
                  onChange={onEditFormChange}
                  onSave={() => onSaveEdit(meal.uuid)}
                  onCancel={onCancelEdit}
                  saving={saving}
                />
              )}
            </div>
          );
        })}

        {!isAdding ? (
          <button
            type="button"
            onClick={onStartAdd}
            className="w-full ios-row py-2 text-sm text-muted-foreground hover:bg-muted/30 flex items-center gap-2"
          >
            <Plus className="size-4" /> Add to {SLOT_LABELS[slot].toLowerCase()}
          </button>
        ) : (
          <div className={`py-3 px-4 ${meals.length > 0 ? 'border-t border-border' : ''}`}>
            <MealAddFields
              form={addForm}
              onChange={onAddFormChange}
              onCancel={onCancelAdd}
              onSave={onSaveAdd}
              saving={saving}
            />
          </div>
        )}
      </div>
    </section>
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
    <div className="space-y-2">
      <input
        type="text"
        placeholder="Meal name"
        value={form.meal_name}
        onChange={(e) => onChange({ ...form, meal_name: e.target.value })}
        className="w-full bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[44px]"
      />
      <div className="flex gap-2 flex-wrap">
        <input
          type="number"
          inputMode="decimal"
          placeholder="Protein (g)"
          value={form.protein_g}
          onChange={(e) => onChange({ ...form, protein_g: e.target.value })}
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[44px]"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Calories"
          value={form.calories}
          onChange={(e) => onChange({ ...form, calories: e.target.value })}
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[44px]"
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="Quality (1-5)"
          value={form.quality_rating}
          min={1}
          max={5}
          onChange={(e) => onChange({ ...form, quality_rating: e.target.value })}
          className="w-28 bg-transparent text-sm outline-none border-b border-border pb-1 min-h-[44px]"
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
          disabled={saving || !form.meal_name}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
