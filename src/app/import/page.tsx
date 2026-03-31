'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { FitbeeImportSummary } from '@/types';
import { apiBase } from '@/lib/api/client';

function fitbeeApiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key ? { 'X-Api-Key': key } : {};
}

type Phase = 'idle' | 'preview' | 'importing' | 'done' | 'error';
type FitbeePhase = 'idle' | 'importing' | 'done' | 'error';

interface WorkoutPreview {
  uuid: string;
  start_time: string;
  title: string | null;
  exerciseCount: number;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

function parseWorkouts(raw: unknown): WorkoutPreview[] {
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.workouts)
      ? (raw as Record<string, unknown>).workouts as unknown[]
      : [];

  return arr.map((w) => {
    const workout = w as Record<string, unknown>;
    return {
      uuid: String(workout.uuid ?? ''),
      start_time: String(workout.start_time ?? workout.start ?? ''),
      title: workout.title ? String(workout.title) : null,
      exerciseCount: Array.isArray(workout.exercises) ? workout.exercises.length : 0,
    };
  }).filter(w => w.uuid && w.start_time);
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function ImportPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [previews, setPreviews] = useState<WorkoutPreview[]>([]);
  const [rawData, setRawData] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [fitbeePhase, setFitbeePhase] = useState<FitbeePhase>('idle');
  const [fitbeeError, setFitbeeError] = useState('');
  const [fitbeeResult, setFitbeeResult] = useState<FitbeeImportSummary | null>(null);
  const fitbeeZipRef = useRef<HTMLInputElement>(null);
  const fitbeeCsvRef = useRef<HTMLInputElement>(null);

  const handleParse = useCallback((text: string) => {
    try {
      const parsed = JSON.parse(text);
      const items = parseWorkouts(parsed);
      if (items.length === 0) {
        setErrorMsg('No valid workouts found in the provided JSON.');
        setPhase('error');
        return;
      }
      setRawData(parsed);
      setPreviews(items);
      setPhase('preview');
    } catch {
      setErrorMsg('Could not parse JSON. Make sure it is a valid Iron export.');
      setPhase('error');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleParse(String(ev.target?.result ?? ''));
    reader.readAsText(file);
  };

  const handleTextParse = () => {
    handleParse(textareaRef.current?.value ?? '');
  };

  const handleImport = async () => {
    if (!rawData) return;
    setPhase('importing');
    try {
      const res = await fetch(`${apiBase()}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error((err as { error?: string }).error ?? 'Import failed');
      }
      const data = await res.json() as ImportResult;
      setResult(data);
      setPhase('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Import failed');
      setPhase('error');
    }
  };

  const reset = () => {
    setPhase('idle');
    setPreviews([]);
    setRawData(null);
    setResult(null);
    setErrorMsg('');
    if (fileRef.current) fileRef.current.value = '';
    if (textareaRef.current) textareaRef.current.value = '';
  };

  const resetFitbee = () => {
    setFitbeePhase('idle');
    setFitbeeError('');
    setFitbeeResult(null);
    if (fitbeeZipRef.current) fitbeeZipRef.current.value = '';
    if (fitbeeCsvRef.current) fitbeeCsvRef.current.value = '';
  };

  const uploadFitbeeZip = useCallback(async (file: File) => {
    setFitbeePhase('importing');
    setFitbeeError('');
    setFitbeeResult(null);
    const fd = new FormData();
    fd.append('archive', file);
    try {
      const res = await fetch(`${apiBase()}/api/import/fitbee`, {
        method: 'POST',
        headers: fitbeeApiHeaders(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? 'Fitbee import failed');
      }
      setFitbeeResult(data as FitbeeImportSummary);
      setFitbeePhase('done');
    } catch (e) {
      setFitbeeError(e instanceof Error ? e.message : 'Fitbee import failed');
      setFitbeePhase('error');
    }
  }, []);

  const uploadFitbeeCsvs = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setFitbeePhase('importing');
    setFitbeeError('');
    setFitbeeResult(null);
    const fd = new FormData();
    const map: Record<string, string> = {
      'food_entries.csv': 'food_entries',
      'water.csv': 'water',
      'weight_entries.csv': 'weight_entries',
      'workouts.csv': 'workouts',
    };
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const field = map[f.name.toLowerCase()];
      if (field) fd.append(field, f);
    }
    if ([...fd.keys()].length === 0) {
      setFitbeeError('No recognised CSV names (food_entries.csv, water.csv, weight_entries.csv, workouts.csv).');
      setFitbeePhase('error');
      return;
    }
    try {
      const res = await fetch(`${apiBase()}/api/import/fitbee`, {
        method: 'POST',
        headers: fitbeeApiHeaders(),
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? 'Fitbee import failed');
      }
      setFitbeeResult(data as FitbeeImportSummary);
      setFitbeePhase('done');
    } catch (e) {
      setFitbeeError(e instanceof Error ? e.message : 'Fitbee import failed');
      setFitbeePhase('error');
    }
  }, []);

  return (
    <main className="tab-content bg-background">
      <div className="sticky top-safe z-10 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/settings" className="text-primary p-1 -ml-1">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-base font-semibold">Import Data</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">

        {/* Idle — input */}
        {(phase === 'idle' || phase === 'error') && (
          <>
            <div className="ios-section">
              <div className="px-4 py-3 space-y-2">
                <p className="text-sm font-medium">Upload JSON file</p>
                <p className="text-xs text-muted-foreground">
                  Export from Iron using Settings → Export, then upload the JSON file here.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary file:text-white file:text-xs file:font-medium"
                />
              </div>
            </div>

            <div className="ios-section">
              <div className="px-4 py-3 space-y-2">
                <p className="text-sm font-medium">Or paste JSON</p>
                <textarea
                  ref={textareaRef}
                  rows={6}
                  placeholder='[{ "uuid": "...", "start_time": "...", "exercises": [...] }]'
                  className="w-full bg-secondary rounded-lg p-3 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none resize-none"
                />
                <button
                  onClick={handleTextParse}
                  className="w-full py-2 bg-primary text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Preview Import
                </button>
              </div>
            </div>

            {phase === 'error' && errorMsg && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-400">{errorMsg}</p>
              </div>
            )}
          </>
        )}

        {/* Preview */}
        {phase === 'preview' && (
          <>
            <div className="ios-section">
              <div className="px-4 py-3">
                <p className="text-sm font-medium mb-1">
                  {previews.length} workout{previews.length !== 1 ? 's' : ''} found
                </p>
                <p className="text-xs text-muted-foreground">
                  Already-imported workouts will be skipped automatically.
                </p>
              </div>
              <div className="divide-y divide-border max-h-64 overflow-y-auto">
                {previews.map(w => (
                  <div key={w.uuid} className="ios-row justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {w.title ?? formatDate(w.start_time)}
                      </p>
                      {w.title && (
                        <p className="text-xs text-muted-foreground">{formatDate(w.start_time)}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {w.exerciseCount} exercise{w.exerciseCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium"
              >
                Import {previews.length} Workout{previews.length !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}

        {/* Importing */}
        {phase === 'importing' && (
          <div className="ios-section px-4 py-8 flex flex-col items-center gap-3">
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Importing workouts…</p>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && result && (
          <>
            <div className="ios-section px-4 py-5 flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-base font-semibold">Import complete</p>
              <p className="text-sm text-muted-foreground">
                {result.imported} imported · {result.skipped} skipped
              </p>
            </div>

            {result.errors.length > 0 && (
              <div className="ios-section px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Errors</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium"
              >
                Import More
              </button>
              <Link
                href="/history"
                className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium text-center"
              >
                View History
              </Link>
            </div>
          </>
        )}

        <div className="ios-section">
          <div className="px-4 py-3 space-y-3">
            <p className="text-sm font-medium">Fitbee export</p>
            <p className="text-xs text-muted-foreground">
              Upload the ZIP from Fitbee, or select the CSV files (food_entries.csv, water.csv,
              weight_entries.csv, workouts.csv). Re-importing skips duplicate rows.
            </p>
            {fitbeePhase === 'idle' || fitbeePhase === 'error' ? (
              <>
                <input
                  ref={fitbeeZipRef}
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFitbeeZip(f);
                  }}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary file:text-white file:text-xs file:font-medium"
                />
                <p className="text-xs text-muted-foreground text-center">or</p>
                <input
                  ref={fitbeeCsvRef}
                  type="file"
                  accept=".csv,text/csv"
                  multiple
                  onChange={(e) => void uploadFitbeeCsvs(e.target.files)}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-secondary file:text-xs file:font-medium"
                />
              </>
            ) : null}
            {fitbeePhase === 'importing' && (
              <div className="flex items-center gap-2 py-2">
                <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">Importing Fitbee data…</span>
              </div>
            )}
            {fitbeePhase === 'error' && fitbeeError && (
              <div className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-400">{fitbeeError}</p>
              </div>
            )}
            {fitbeePhase === 'done' && fitbeeResult && (
              <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-1 text-xs">
                <p className="font-medium text-sm text-foreground">Fitbee import complete</p>
                <p>Food lines: {fitbeeResult.food_entries_inserted} new · {fitbeeResult.food_entries_skipped_duplicates} skipped</p>
                <p>Meal aggregates updated: {fitbeeResult.nutrition_aggregates_upserted}</p>
                <p>Water days: {fitbeeResult.water_days_updated}</p>
                <p>Weights: {fitbeeResult.weights_inserted} new · {fitbeeResult.weights_skipped_duplicates} skipped</p>
                <p>Activities: {fitbeeResult.activities_inserted} new · {fitbeeResult.activities_skipped_duplicates} skipped</p>
                {fitbeeResult.warnings.length > 0 && (
                  <p className="text-amber-700 dark:text-amber-400 pt-1">
                    {fitbeeResult.warnings.length} parser warning(s) — check Nutrition for totals.
                  </p>
                )}
                <button
                  type="button"
                  onClick={resetFitbee}
                  className="mt-2 w-full py-2 border border-border rounded-lg text-sm font-medium"
                >
                  Import another export
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
