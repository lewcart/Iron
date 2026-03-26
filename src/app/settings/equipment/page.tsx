'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { EQUIPMENT_OPTIONS, REBIRTH_EQUIPMENT_LS_KEY } from '@/lib/available-equipment';

function readLS(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${
        on ? 'bg-gradient-to-r from-trans-blue to-trans-pink' : 'bg-secondary'
      }`}
    >
      <span
        className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsEquipmentPage() {
  const [equipment, setEquipment] = useState<Set<string>>(new Set());

  useEffect(() => {
    const eq = readLS(REBIRTH_EQUIPMENT_LS_KEY, '');
    if (eq) {
      try {
        setEquipment(new Set(JSON.parse(eq)));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const toggleEquipment = (id: string) => {
    setEquipment(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      localStorage.setItem(REBIRTH_EQUIPMENT_LS_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-14 pb-4 flex items-center gap-3">
        <Link href="/settings" className="text-primary p-1 -ml-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Available Equipment</h1>
      </div>

      <div className="px-4 pb-8">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
          What you can use
        </p>
        <p className="text-caption px-1 mb-3">
          Toggle everything you have access to when training. This is for your own reference.
        </p>
        <div className="ios-section">
          {EQUIPMENT_OPTIONS.map(opt => (
            <div key={opt.id} className="ios-row justify-between">
              <span className="text-sm font-medium">{opt.label}</span>
              <Toggle on={equipment.has(opt.id)} onToggle={() => toggleEquipment(opt.id)} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
