'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Trash2,
  User,
  Scale,
  Utensils,
  Heart,
  Pill,
  Timer,
  Download,
  Upload,
  Info,
  Camera,
  Dumbbell,
} from 'lucide-react';
import Link from 'next/link';
import { useUnit } from '@/context/UnitContext';
import { REBIRTH_EQUIPMENT_LS_KEY } from '@/lib/available-equipment';
import type { BodyweightLog } from '@/types';

const REST_TIMES = [30, 60, 90, 120, 150, 180, 210, 240, 300];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${m}:00`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const LS_PROFILE_NAME = 'rebirth-profile-name';
const LS_PROFILE_PRONOUNS = 'rebirth-profile-pronouns';

function readLS(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function writeLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function formatLogDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Icon badge ────────────────────────────────────────────
function IconBadge({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 ${bg}`}>
      {children}
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${
        on
          ? 'bg-gradient-to-r from-trans-blue to-trans-pink'
          : 'bg-secondary'
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

export default function SettingsPage() {
  const { unit, setUnit, toDisplay, fromInput, label } = useUnit();

  // Rest timer
  const [defaultRest, setDefaultRest] = useState(() =>
    parseInt(readLS('iron-rest-default', '90'), 10)
  );
  const [autoStart, setAutoStart] = useState(() =>
    readLS('iron-rest-auto-start', 'true') !== 'false'
  );
  const [keepRestRunning, setKeepRestRunning] = useState(() =>
    readLS('iron-rest-keep-running', 'false') === 'true'
  );

  // Profile
  const [profileName, setProfileName] = useState('');
  const [profilePronouns, setProfilePronouns] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profilePronounsDraft, setProfilePronounsDraft] = useState('');
  const profileSnapshotRef = useRef({ name: '', pronouns: '' });

  const [equipmentSelectedCount, setEquipmentSelectedCount] = useState(0);

  // Bodyweight
  const [bwInput, setBwInput] = useState('');
  const [bwNote, setBwNote] = useState('');
  const [bwLogs, setBwLogs] = useState<BodyweightLog[]>([]);
  const [bwLoading, setBwLoading] = useState(true);
  const [bwSaving, setBwSaving] = useState(false);

  // Load persisted values
  useEffect(() => {
    const name = readLS(LS_PROFILE_NAME, '');
    const pronouns = readLS(LS_PROFILE_PRONOUNS, '');
    setProfileName(name);
    setProfilePronouns(pronouns);

    const eq = readLS(REBIRTH_EQUIPMENT_LS_KEY, '');
    if (eq) {
      try {
        const arr = JSON.parse(eq);
        setEquipmentSelectedCount(Array.isArray(arr) ? arr.length : 0);
      } catch {
        setEquipmentSelectedCount(0);
      }
    }

    fetch('/api/bodyweight?limit=30')
      .then(r => r.json())
      .then((data: BodyweightLog[]) => {
        setBwLogs(data);
        setBwLoading(false);
      })
      .catch(() => setBwLoading(false));
  }, []);

  // While editing profile, keep header + localStorage in sync on every change
  useEffect(() => {
    if (!editingProfile) return;
    setProfileName(profileNameDraft);
    setProfilePronouns(profilePronounsDraft);
    writeLS(LS_PROFILE_NAME, profileNameDraft);
    writeLS(LS_PROFILE_PRONOUNS, profilePronounsDraft);
  }, [editingProfile, profileNameDraft, profilePronounsDraft]);

  // ── Handlers ──────────────────────────────────────────

  const updateDefaultRest = (v: number) => {
    setDefaultRest(v);
    localStorage.setItem('iron-rest-default', String(v));
  };

  const updateAutoStart = (v: boolean) => {
    setAutoStart(v);
    localStorage.setItem('iron-rest-auto-start', String(v));
    if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const updateKeepRestRunning = (v: boolean) => {
    setKeepRestRunning(v);
    localStorage.setItem('iron-rest-keep-running', String(v));
  };

  const openProfileEdit = () => {
    const name = readLS(LS_PROFILE_NAME, profileName);
    const pronouns = readLS(LS_PROFILE_PRONOUNS, profilePronouns);
    profileSnapshotRef.current = { name, pronouns };
    setProfileName(name);
    setProfilePronouns(pronouns);
    setProfileNameDraft(name);
    setProfilePronounsDraft(pronouns);
    setEditingProfile(true);
  };

  const saveProfile = () => {
    writeLS(LS_PROFILE_NAME, profileNameDraft);
    writeLS(LS_PROFILE_PRONOUNS, profilePronounsDraft);
    setEditingProfile(false);
  };

  const cancelProfileEdit = () => {
    const { name, pronouns } = profileSnapshotRef.current;
    setProfileNameDraft(name);
    setProfilePronounsDraft(pronouns);
    setProfileName(name);
    setProfilePronouns(pronouns);
    writeLS(LS_PROFILE_NAME, name);
    writeLS(LS_PROFILE_PRONOUNS, pronouns);
    setEditingProfile(false);
  };

  const handleLogBodyweight = async () => {
    const val = parseFloat(bwInput);
    if (!val || val <= 0) return;
    setBwSaving(true);
    try {
      const weight_kg = fromInput(val);
      const res = await fetch('/api/bodyweight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_kg, note: bwNote || undefined }),
      });
      if (res.ok) {
        const log: BodyweightLog = await res.json();
        setBwLogs(prev => [log, ...prev]);
        setBwInput('');
        setBwNote('');
      }
    } finally {
      setBwSaving(false);
    }
  };

  const handleDeleteBw = async (uuid: string) => {
    await fetch(`/api/bodyweight/${uuid}`, { method: 'DELETE' });
    setBwLogs(prev => prev.filter(l => l.uuid !== uuid));
  };

  // ── Derived ───────────────────────────────────────────

  const initials = profileName
    ? profileName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : null;

  return (
    <main className="tab-content bg-background">

      {/* ── Gradient header ─────────────────────────────── */}
      <div className="gradient-brand pt-safe pb-6 px-4 relative">
        <div className="flex items-end gap-4">
          {/* Avatar */}
          <button
            onClick={openProfileEdit}
            className="w-18 h-18 rounded-full bg-white/30 border-2 border-white/60 flex items-center justify-center flex-shrink-0 w-[72px] h-[72px]"
          >
            {initials ? (
              <span className="text-2xl font-bold text-white">{initials}</span>
            ) : (
              <User className="w-8 h-8 text-white" />
            )}
          </button>

          {/* Name & pronouns */}
          <div className="flex-1 min-w-0 pb-1">
            {profileName ? (
              <>
                <p className="text-xl font-bold text-white leading-tight truncate">{profileName}</p>
                {profilePronouns && (
                  <p className="text-sm text-white/80 mt-0.5">{profilePronouns}</p>
                )}
              </>
            ) : (
              <button onClick={openProfileEdit} className="text-white/90 text-sm font-medium">
                Tap to set your name →
              </button>
            )}
          </div>
        </div>

        {/* Wordmark */}
        <p className="absolute top-4 right-4 text-white/60 text-xs font-semibold tracking-widest uppercase">
          Rebirth
        </p>
      </div>

      <div className="px-4 space-y-5 py-5">

        {/* ── Profile edit (inline) ───────────────────── */}
        {editingProfile && (
          <div>
            <p className="text-label-section mb-1 px-1">Profile</p>
            <div className="ios-section">
              <div className="ios-row gap-3">
                <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Your name"
                  value={profileNameDraft}
                  onChange={e => setProfileNameDraft(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                  autoFocus
                />
              </div>
              <div className="ios-row gap-3">
                <span className="w-4 h-4 text-center text-muted-foreground text-xs flex-shrink-0">✦</span>
                <input
                  type="text"
                  placeholder="Pronouns (e.g. she/her)"
                  value={profilePronounsDraft}
                  onChange={e => setProfilePronounsDraft(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                />
              </div>
              <div className="ios-row gap-2 justify-end">
                <button
                  type="button"
                  onClick={cancelProfileEdit}
                  className="px-4 py-1.5 text-sm text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveProfile}
                  className="px-4 py-1.5 gradient-brand text-white text-sm font-semibold rounded-lg"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── App ─────────────────────────────────────── */}
        <div>
          <p className="text-label-section mb-1 px-1">App</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-orange-400">
                  <Scale className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Weight Unit</span>
              </div>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {(['kg', 'lbs'] as const).map(u => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                      unit === u
                        ? 'gradient-brand text-white'
                        : 'text-foreground'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Equipment ───────────────────────────────── */}
        <div>
          <p className="text-label-section mb-1 px-1">Equipment</p>
          <div className="ios-section">
            <Link href="/settings/equipment" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-slate-600">
                  <Dumbbell className="w-4 h-4 text-white" />
                </IconBadge>
                <div className="min-w-0">
                  <span className="text-sm font-medium">Available Equipment</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {equipmentSelectedCount === 0
                      ? 'Nothing selected yet'
                      : `${equipmentSelectedCount} selected`}
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </Link>
          </div>
        </div>

        {/* ── Modules ─────────────────────────────────── */}
        <div>
          <p className="text-label-section mb-1 px-1">Modules</p>
          <div className="ios-section">
            <Link href="/body-spec" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-[#5BCEFA]">
                  <User className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Body Spec</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link href="/measurements" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-rose-400">
                  <Camera className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Measurements & Photos</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link href="/nutrition" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-emerald-500">
                  <Utensils className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Nutrition</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link href="/wellbeing" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-violet-500">
                  <Heart className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Wellbeing & Identity</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link href="/hrt" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-[#F5A9B8]">
                  <Pill className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">HRT Tracking</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </div>

        {/* ── Bodyweight ──────────────────────────────── */}
        <div>
          <p className="text-label-section mb-1 px-1">Bodyweight</p>
          <div className="ios-section">
            <div className="ios-row gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder={`Weight (${label})`}
                value={bwInput}
                onChange={e => setBwInput(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={bwNote}
                onChange={e => setBwNote(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px] text-muted-foreground"
              />
              <button
                onClick={handleLogBodyweight}
                disabled={bwSaving || !bwInput}
                className="px-3 py-1.5 gradient-brand text-white text-sm font-semibold rounded-lg disabled:opacity-40"
              >
                Log
              </button>
            </div>
          </div>

          {!bwLoading && bwLogs.length > 0 && (
            <div className="ios-section mt-2">
              {bwLogs.map(log => (
                <div key={log.uuid} className="ios-row justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">
                      {toDisplay(log.weight_kg)} {label}
                    </span>
                    {log.note && (
                      <span className="text-xs text-muted-foreground ml-2">{log.note}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground mr-3">
                    {formatLogDate(log.logged_at)}
                  </span>
                  <button
                    onClick={() => handleDeleteBw(log.uuid)}
                    className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!bwLoading && bwLogs.length === 0 && (
            <p className="text-caption px-1 mt-2">No bodyweight entries yet.</p>
          )}
        </div>

        {/* ── Rest Timer ──────────────────────────────── */}
        <div>
          <p className="text-label-section mb-1 px-1">Rest Timer</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-amber-500">
                  <Timer className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Default Rest Time</span>
              </div>
              <select
                value={defaultRest}
                onChange={e => updateDefaultRest(Number(e.target.value))}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              >
                {REST_TIMES.map(t => (
                  <option key={t} value={t}>{formatTime(t)}</option>
                ))}
              </select>
            </div>
            <div className="ios-row justify-between">
              <div className="flex-1">
                <span className="text-sm font-medium">Auto-start after Set</span>
                <p className="text-xs text-muted-foreground mt-0.5 pr-4">
                  Automatically starts the rest timer when you complete a set.
                </p>
              </div>
              <Toggle on={autoStart} onToggle={() => updateAutoStart(!autoStart)} />
            </div>
            <div className="ios-row justify-between">
              <div className="flex-1">
                <span className="text-sm font-medium">Keep Rest Timer Running</span>
                <p className="text-xs text-muted-foreground mt-0.5 pr-4">
                  Shows a red countdown when the rest period has elapsed.
                </p>
              </div>
              <Toggle on={keepRestRunning} onToggle={() => updateKeepRestRunning(!keepRestRunning)} />
            </div>
          </div>
        </div>

        {/* ── Data ────────────────────────────────────── */}
        <div>
          <p className="text-label-section mb-1 px-1">Data</p>
          <div className="ios-section">
            <Link href="/import" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-slate-500">
                  <Upload className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Import Data</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <a href="/api/export?format=json" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-slate-500">
                  <Download className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Export Data (JSON)</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </a>
            <a href="/api/export?format=csv" className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-slate-400">
                  <Download className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Export Data (CSV)</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </a>
          </div>
        </div>

        {/* ── About ───────────────────────────────────── */}
        <div>
          <p className="text-label-section mb-1 px-1">About</p>
          <div className="ios-section">
            <div className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="gradient-brand">
                  <Info className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Rebirth</span>
              </div>
              <span className="text-sm text-muted-foreground">v1.0</span>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
