'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { updateMeal, deleteMeal } from '@/lib/mutations-nutrition';
import type { LocalNutritionLog } from '@/db/local';

interface Props {
  open: boolean;
  onClose: () => void;
  log: LocalNutritionLog | null;
}

export function EditFoodSheet({ open, onClose, log }: Props) {
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (log) {
      setName(log.meal_name ?? '');
      setCalories(log.calories?.toString() ?? '');
      setProtein(log.protein_g?.toString() ?? '');
      setCarbs(log.carbs_g?.toString() ?? '');
      setFat(log.fat_g?.toString() ?? '');
    }
  }, [log]);

  async function save() {
    if (!log) return;
    setSaving(true);
    try {
      await updateMeal(log.uuid, {
        meal_name: name.trim() || null,
        calories: calories ? parseFloat(calories) : null,
        protein_g: protein ? parseFloat(protein) : null,
        carbs_g: carbs ? parseFloat(carbs) : null,
        fat_g: fat ? parseFloat(fat) : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!log) return;
    setSaving(true);
    try {
      await deleteMeal(log.uuid);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit food"
      height="auto"
      footer={
        <div className="flex gap-2">
          <Button variant="destructive" onClick={remove} disabled={saving}>
            Delete
          </Button>
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Food name"
          className="w-full h-10 px-3 rounded-lg bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="grid grid-cols-4 gap-2">
          <Field label="Cal" value={calories} onChange={setCalories} />
          <Field label="Pro" value={protein} onChange={setProtein} />
          <Field label="Carb" value={carbs} onChange={setCarbs} />
          <Field label="Fat" value={fat} onChange={setFat} />
        </div>
      </div>
    </Sheet>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-center">
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-2 rounded-lg bg-muted/40 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
