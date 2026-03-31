'use client';

/**
 * GeofenceOnboarding
 *
 * Shown the first time the user enables "Auto-end at home".
 * Explains why "Always" location permission is needed before triggering the
 * native iOS permission prompt.
 */

import { useState } from 'react';
import { MapPin, Home, Shield, X } from 'lucide-react';

interface Props {
  onConfirm: () => void;
  onDismiss: () => void;
}

export function GeofenceOnboarding({ onConfirm, onDismiss }: Props) {
  const [step, setStep] = useState<'explain' | 'permission'>('explain');

  if (step === 'permission') {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-t-2xl bg-zinc-900 p-6 pb-safe space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Allow background location</h2>
            <button onClick={onDismiss} className="text-zinc-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">
            On the next screen, iOS will ask for location permission.
            Choose <span className="font-semibold text-white">&ldquo;Always Allow&rdquo;</span> so
            Rebirth can detect your arrival even when the app is closed.
          </p>
          <div className="rounded-xl bg-zinc-800 p-4 space-y-2">
            <p className="text-xs font-medium text-zinc-300 uppercase tracking-wide">
              What we use it for
            </p>
            <ul className="text-sm text-zinc-400 space-y-1 list-disc list-inside">
              <li>Detect when you enter a 175 m radius around your home</li>
              <li>Wait 30 seconds to confirm you&apos;ve arrived (not just passing by)</li>
              <li>Automatically end your workout and notify you</li>
            </ul>
          </div>
          <p className="text-xs text-zinc-500">
            Your location is processed entirely on-device. It is never sent to any server.
          </p>
          <button
            onClick={onConfirm}
            className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-black active:opacity-80"
          >
            Continue to permission
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl bg-zinc-900 p-6 pb-safe space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Auto-end at home</h2>
          <button onClick={onDismiss} className="text-zinc-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <Feature
            icon={<Home size={20} className="text-white" />}
            title="Arrives home → workout ends"
            body="Rebirth watches for when you cross into a small area around your home address."
          />
          <Feature
            icon={<MapPin size={20} className="text-white" />}
            title="Works even when the app is closed"
            body="iOS keeps the geofence active in the background. The app relaunches briefly to end your session."
          />
          <Feature
            icon={<Shield size={20} className="text-white" />}
            title="Private — stays on your device"
            body="Location data never leaves your phone. No servers, no tracking."
          />
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setStep('permission')}
            className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-black active:opacity-80"
          >
            Set up auto-end
          </button>
          <button
            onClick={onDismiss}
            className="w-full rounded-xl bg-zinc-800 py-3 text-sm font-semibold text-zinc-300 active:opacity-80"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-sm text-zinc-400 mt-0.5">{body}</p>
      </div>
    </div>
  );
}
