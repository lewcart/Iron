'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true); // start hidden until we know

  useEffect(() => {
    if (localStorage.getItem('iron-install-dismissed')) return;
    setDismissed(false);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (dismissed || !deferredPrompt) return null;

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setDismissed(true);
    }
  }

  function dismiss() {
    localStorage.setItem('iron-install-dismissed', '1');
    setDismissed(true);
  }

  return (
    <div className="fixed bottom-[83px] left-0 right-0 z-40 px-4 pb-2 safe-area-bottom">
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl">
        <div className="w-9 h-9 rounded-xl bg-[#007AFF] flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100">Add Iron to Home Screen</p>
          <p className="text-xs text-zinc-400">For the best offline experience</p>
        </div>
        <button
          onClick={install}
          className="px-3 py-1.5 rounded-lg bg-[#007AFF] text-white text-xs font-semibold flex-shrink-0"
        >
          Add
        </button>
        <button onClick={dismiss} className="text-zinc-500 hover:text-zinc-300 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
