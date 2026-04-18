'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import type { WeightUnit } from '@/lib/units';
import { toDisplayWeight, fromDisplayWeight, roundDisplayWeight } from '@/lib/units';

interface UnitContextValue {
  unit: WeightUnit;
  setUnit: (unit: WeightUnit) => void;
  /** Convert a stored kg value to the display unit (rounded). */
  toDisplay: (kg: number) => number;
  /** Convert a user-entered display value back to kg for DB storage. */
  fromInput: (val: number) => number;
  /** The unit label string: 'kg' or 'lbs'. */
  label: string;
}

const UnitContext = createContext<UnitContextValue>({
  unit: 'kg',
  setUnit: () => {},
  toDisplay: v => v,
  fromInput: v => v,
  label: 'kg',
});

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnitState] = useState<WeightUnit>('kg');

  useEffect(() => {
    const stored = localStorage.getItem('rebirth-weight-unit') as WeightUnit | null;
    if (stored === 'kg' || stored === 'lbs') {
      setUnitState(stored);
    }
  }, []);

  const setUnit = (u: WeightUnit) => {
    setUnitState(u);
    localStorage.setItem('rebirth-weight-unit', u);
  };

  return (
    <UnitContext.Provider
      value={{
        unit,
        setUnit,
        toDisplay: (kg: number) => roundDisplayWeight(toDisplayWeight(kg, unit), unit),
        fromInput: (val: number) => fromDisplayWeight(val, unit),
        label: unit,
      }}
    >
      {children}
    </UnitContext.Provider>
  );
}

export function useUnit() {
  return useContext(UnitContext);
}
