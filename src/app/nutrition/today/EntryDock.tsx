'use client';

import { useState } from 'react';
import { Plus, Camera, Type } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';

interface Props {
  onAdd: () => void;
}

/**
 * Floating bottom dock — FitBee-parity. `+` is the primary "add food" action;
 * 📷 (photo log) and Aa (text/AI parser) are stubbed as "coming soon" until
 * the underlying integrations exist.
 */
export function EntryDock({ onAdd }: Props) {
  const [comingSoon, setComingSoon] = useState<null | 'photo' | 'text'>(null);

  return (
    <>
      <div
        className="fixed left-1/2 -translate-x-1/2 z-30 pointer-events-none"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-amber-500/95 backdrop-blur shadow-lg p-1">
          <DockButton onClick={onAdd} ariaLabel="Add food">
            <Plus className="size-5 text-white" strokeWidth={2.5} />
          </DockButton>
          <DockButton onClick={() => setComingSoon('photo')} ariaLabel="Photo log">
            <Camera className="size-5 text-white" />
          </DockButton>
          <DockButton onClick={() => setComingSoon('text')} ariaLabel="Text log">
            <Type className="size-5 text-white" />
          </DockButton>
        </div>
      </div>

      <Sheet
        open={comingSoon !== null}
        onClose={() => setComingSoon(null)}
        title={comingSoon === 'photo' ? 'Photo logging' : 'Text / AI logging'}
        height="auto"
      >
        <div className="p-6 text-sm text-muted-foreground space-y-3">
          {comingSoon === 'photo' ? (
            <>
              <p>Snap a photo of your meal and have it estimate macros automatically.</p>
              <p className="font-medium text-foreground">Coming soon.</p>
              <p>For now, add foods manually or via search.</p>
            </>
          ) : (
            <>
              <p>Describe a meal in plain text and have it parsed into macros.</p>
              <p className="font-medium text-foreground">Coming soon.</p>
              <p>For now, add foods manually or via search.</p>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function DockButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="size-11 inline-flex items-center justify-center rounded-full hover:bg-white/10 active:bg-white/20 transition-colors"
    >
      {children}
    </button>
  );
}
