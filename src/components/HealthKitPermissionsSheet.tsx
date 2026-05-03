'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { HealthKit } from '@/lib/healthkit';
import { markPermissionsRequested } from '@/features/health/healthService';
import { HK_TYPES, type HKTypeRow } from '@/lib/healthkit-catalog';

// HK_TYPES is derived from src/lib/healthkit-types.json — the same JSON that
// generates ios/App/App/HealthKitTypes.swift via scripts/gen-healthkit-types.mjs.
// Single source of truth: drift between TS and Swift is structurally impossible.
//
// READ status is opaque on iOS by design — Apple hides whether a read permission
// was granted/denied for privacy reasons. The Swift bridge always reports
// 'notDetermined' for read-only types. We surface that limitation in the UI
// rather than pretending we know.
//
// WRITE status reflects the real authorization state.

export type { HKTypeRow };

type StatusValue = 'granted' | 'denied' | 'notDetermined' | 'unknown';

function statusOf(map: Record<string, string> | null, key: string): StatusValue {
  if (!map) return 'unknown';
  const raw = map[key];
  if (raw === 'granted' || raw === 'denied' || raw === 'notDetermined') return raw;
  return 'unknown';
}

function StatusPill({ status, opaque }: { status: StatusValue; opaque: boolean }) {
  if (opaque) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-[10px] font-medium">
        <ShieldQuestion className="w-3 h-3" />
        Hidden by iOS
      </span>
    );
  }
  if (status === 'granted') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-medium">
        <ShieldCheck className="w-3 h-3" />
        Granted
      </span>
    );
  }
  if (status === 'denied') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 text-[10px] font-medium">
        <ShieldOff className="w-3 h-3" />
        Denied
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-[10px] font-medium">
      <ShieldQuestion className="w-3 h-3" />
      Not asked
    </span>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HealthKitPermissionsSheet({ open, onClose }: Props) {
  const [statuses, setStatuses] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState(false);
  // 'shouldRequest' = iOS will actually show the sheet (new types or first-ever ask).
  // 'unnecessary'   = every type in the request set has already been answered;
  //                   tapping Request will silently no-op. UI hides the button.
  // 'unknown'       = iOS refused to answer (rare); treat like shouldRequest.
  // null            = haven't asked yet / not on iOS.
  const [requestStatus, setRequestStatus] = useState<'shouldRequest' | 'unnecessary' | 'unknown' | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { available } = await HealthKit.isAvailable();
      if (!available) {
        setStatuses(null);
        setRequestStatus(null);
        return;
      }
      const [{ statuses }, status] = await Promise.all([
        HealthKit.checkPermissionStatus(),
        HealthKit.getRequestStatus().catch(() => ({ status: 'unknown' as const, shouldRequest: true })),
      ]);
      setStatuses(statuses);
      setRequestStatus(status.status);
    } catch {
      setStatuses(null);
      setRequestStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleRequest = useCallback(async () => {
    setRequesting(true);
    try {
      await HealthKit.requestPermissions();
      markPermissionsRequested();
      await refresh();
    } catch {
      // Silent fail — status reload will show whatever changed.
    } finally {
      setRequesting(false);
    }
  }, [refresh]);

  const openIosSettings = useCallback(() => {
    // Privacy → Health → Rebirth lives in the iOS Settings app. The
    // `x-apple-health://` deep link opens the Health app, where Sources →
    // Rebirth gives the same per-type toggle UI. Try Health first, fall back
    // to general Settings.
    try {
      window.open('x-apple-health://Sources', '_system');
    } catch {
      window.open('app-settings:', '_system');
    }
  }, []);

  const reads = HK_TYPES.filter((t) => t.read);
  const writes = HK_TYPES.filter((t) => t.write);

  return (
    <Sheet open={open} onClose={onClose} title="Apple Health Permissions" height="85vh">
      <div className="px-4 py-3 space-y-4">
        {/* Caveat banner */}
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <p className="font-semibold mb-1">Two things iOS won&rsquo;t let Rebirth do:</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Show whether <em>read</em> access is granted &mdash; Apple hides this for privacy.</li>
            <li>Revoke any access from inside the app. Use <span className="font-medium">Manage in Health app</span> below.</li>
          </ol>
        </div>

        {/* Reads */}
        <section>
          <div className="flex items-baseline justify-between px-1 mb-1">
            <h3 className="text-label-section">Reads</h3>
            <span className="text-[10px] text-muted-foreground">Status hidden by iOS</span>
          </div>
          <div className="ios-section">
            {reads.map((row) => (
              <div key={`r-${row.statusKey}`} className="ios-row justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{row.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.blurb}</p>
                </div>
                <StatusPill status={statusOf(statuses, row.statusKey)} opaque />
              </div>
            ))}
          </div>
        </section>

        {/* Writes */}
        <section>
          <div className="flex items-baseline justify-between px-1 mb-1">
            <h3 className="text-label-section">Writes</h3>
            <span className="text-[10px] text-muted-foreground">
              {loading ? 'Checking…' : 'Live status'}
            </span>
          </div>
          <div className="ios-section">
            {writes.map((row) => (
              <div key={`w-${row.statusKey}`} className="ios-row justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{row.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.blurb}</p>
                </div>
                <StatusPill status={statusOf(statuses, row.statusKey)} opaque={false} />
              </div>
            ))}
          </div>
        </section>

        {/* Actions */}
        <section>
          <p className="text-label-section mb-1 px-1">Actions</p>
          <div className="ios-section">
            {requestStatus !== 'unnecessary' && (
              <button
                onClick={handleRequest}
                disabled={requesting}
                className="ios-row justify-between w-full text-left disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-blue-500/20">
                    <RefreshCw className={`w-4 h-4 text-blue-400 ${requesting ? 'animate-spin' : ''}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Request authorization</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      iOS will show the sheet for any types you haven&rsquo;t answered yet.
                    </p>
                  </div>
                </div>
              </button>
            )}
            <button
              onClick={openIosSettings}
              className="ios-row justify-between w-full text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-secondary">
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Manage in Health app</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {requestStatus === 'unnecessary'
                      ? 'You’ve already answered every type. Toggle access here.'
                      : 'Sources → Rebirth lets you toggle each type on or off.'}
                  </p>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground px-1 mt-2 leading-relaxed">
            {requestStatus === 'unnecessary'
              ? 'iOS won’t re-show the permission sheet once every type has an answer — by design, for privacy. Use Manage in Health app to flip individual toggles.'
              : 'iOS only shows the sheet for types you haven’t answered yet. To revoke an already-granted type, open the Health app.'}
          </p>
        </section>
      </div>
    </Sheet>
  );
}
