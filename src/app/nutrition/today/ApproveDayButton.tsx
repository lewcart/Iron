'use client';

import { Check } from 'lucide-react';
import { approveDayNote } from '@/lib/mutations-nutrition';
import { canApproveDay, type DayDisplayStatus } from '@/lib/nutrition-time';
import { useState } from 'react';

interface Props {
  date: string;
  status: DayDisplayStatus;
}

export function ApproveDayButton({ date, status }: Props) {
  const [busy, setBusy] = useState(false);
  const can = canApproveDay(date);
  const isApproved = status.kind === 'reviewed';

  async function handleClick() {
    if (busy || isApproved || !can) return;
    setBusy(true);
    try {
      await approveDayNote(date);
    } finally {
      setBusy(false);
    }
  }

  if (!can) {
    return (
      <button
        type="button"
        disabled
        className="w-full h-12 rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground"
      >
        Future day — nothing to review yet
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || isApproved}
      className={
        isApproved
          ? 'w-full h-12 rounded-xl bg-emerald-500/10 text-emerald-500 text-sm font-semibold flex items-center justify-center gap-2'
          : 'w-full h-12 rounded-xl bg-emerald-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors disabled:opacity-60'
      }
    >
      <Check className="size-4" />
      {isApproved ? 'Day reviewed' : busy ? 'Saving…' : 'Mark day reviewed'}
    </button>
  );
}
