'use client';

import { useEffect, useState } from 'react';
import { syncEngine, type SyncStatus as SyncStatusType, type SyncErrorDetails } from '@/lib/sync';

// SyncStatus is a *passive* indicator. It shows a small pill at the bottom
// of the screen when a sync is happening, the device is offline, or push/pull
// has errored. It NEVER blocks the UI with a full-screen overlay.
//
// Hydration of the bundled exercise catalog and starting the sync engine
// happen in providers.tsx, alongside HealthKitResumeSync, so foreground-sync
// triggers are consolidated in one place.
//
// Tap-to-copy: when status is 'error', tapping the pill copies a verbose,
// paste-ready bug report (kind, HTTP status, URL, response body, payload
// summary, UA, page URL, stack) to the clipboard and reveals it inline so
// Lou can paste it back to the assistant for diagnosis.

function formatErrorReport(d: SyncErrorDetails): string {
  const lines: string[] = [];
  lines.push(`Sync error (${d.kind})`);
  lines.push(`At: ${d.at}`);
  if (d.status !== undefined || d.url) {
    lines.push(`HTTP: ${d.status ?? '—'} ${d.method ?? ''} ${d.url ?? ''}`.trim());
  }
  lines.push(`Message: ${d.message}`);
  if (d.responseBody) {
    lines.push('Response body:');
    lines.push(d.responseBody);
  }
  if (d.payloadSummary && d.payloadSummary.length > 0) {
    lines.push('Push payload:');
    for (const p of d.payloadSummary) {
      const sample = p.sampleUuids.length > 0 ? ` [${p.sampleUuids.join(', ')}…]` : '';
      lines.push(`  ${p.table}: ${p.count}${sample}`);
    }
  }
  if (d.cursor !== undefined) lines.push(`Cursor: ${d.cursor}`);
  if (d.pageUrl) lines.push(`Page: ${d.pageUrl}`);
  if (d.userAgent) lines.push(`UA: ${d.userAgent}`);
  if (d.stack) {
    lines.push('Stack:');
    lines.push(d.stack);
  }
  return lines.join('\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusType>(syncEngine.status);
  const [showError, setShowError] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    const unsub = syncEngine.subscribe(s => {
      setStatus(s);
      if (s !== 'error') {
        setShowError(false);
        setCopied('idle');
      }
    });
    return unsub;
  }, []);

  // Don't render anything when idle and synced (most of the time).
  if (status === 'idle') return null;

  const details = syncEngine.lastErrorDetails;
  const fallbackMsg = syncEngine.lastError;
  // Always render *something* in the expanded panel. If the engine left no
  // captured details (regression path: push errored, pull cleared its state,
  // sync() re-set status='error'), show a placeholder so the pill's
  // "long-press text below" instruction is never a lie.
  const report = details
    ? formatErrorReport(details)
    : fallbackMsg
      ? fallbackMsg
      : 'Sync error — no details captured. Check the JS console for [sync] logs.';

  const handleClick = async () => {
    if (status !== 'error') return;
    setShowError(v => !v);
    const ok = await copyText(report);
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied('idle'), 2500);
  };

  return (
    <div
      className="fixed left-0 right-0 z-50 flex flex-col items-center justify-center py-1 pointer-events-none"
      style={{ bottom: 'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium shadow-lg bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 pointer-events-auto"
        onClick={handleClick}
        aria-expanded={status === 'error' ? showError : undefined}
        aria-label={status === 'error' ? 'Sync error — tap to copy details' : undefined}
      >
        {status === 'syncing' && (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-zinc-300">Syncing…</span>
          </>
        )}
        {status === 'offline' && (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span className="text-zinc-400">Offline</span>
          </>
        )}
        {status === 'error' && (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className="text-zinc-300">
              {copied === 'ok' ? 'Copied — paste to chat' : copied === 'fail' ? 'Copy failed — long-press text below' : 'Sync error — tap to copy'}
            </span>
          </>
        )}
      </button>

      {status === 'error' && showError && (
        <div className="mt-2 max-w-[92vw] max-h-[40vh] overflow-auto rounded-lg bg-zinc-900/95 backdrop-blur-sm border border-zinc-800 shadow-lg pointer-events-auto">
          <pre className="text-[10px] leading-snug text-zinc-300 whitespace-pre-wrap break-words p-3 select-text">
            {report}
          </pre>
        </div>
      )}
    </div>
  );
}
