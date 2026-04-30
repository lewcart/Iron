'use client';

import { useState } from 'react';
import { ChevronLeft, Trash2, Check, X } from 'lucide-react';
import Link from 'next/link';
import type { LocalHrtProtocol } from '@/db/local';
import { useHrtLogs, useHrtProtocols } from '@/lib/useLocalDB-hrt';
import {
  logHrtDose,
  deleteHrtLog,
  createHrtProtocol,
  endHrtProtocol,
  deleteHrtProtocol,
} from '@/lib/mutations-hrt';

// Local-first /hrt across three tabs (Today / Protocols / History).
// Reads via useHrtLogs + useHrtProtocols; writes via mutations-hrt.

type Tab = 'today' | 'protocols' | 'history';

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ===== Today Tab =====

function TodayTab() {
  const logs = useHrtLogs(30);
  const protocols = useHrtProtocols();
  const activeProtocol = protocols.find(p => !p.ended_at) ?? null;
  const [taken, setTaken] = useState<boolean>(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleLog = async () => {
    setSaving(true);
    try {
      await logHrtDose({
        medication: activeProtocol?.medication ?? 'estradiol',
        taken,
        notes: notes || null,
        hrt_protocol_uuid: activeProtocol?.uuid ?? null,
      });
      setNotes('');
      setTaken(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {activeProtocol && (
        <div className="ios-section">
          <div className="ios-row flex-col items-start gap-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Active Protocol</p>
            <p className="text-sm font-semibold">{activeProtocol.medication} — {activeProtocol.dose_description}</p>
            <p className="text-xs text-muted-foreground capitalize">{activeProtocol.form} · Started {formatDate(activeProtocol.started_at)}</p>
            {activeProtocol.includes_blocker && activeProtocol.blocker_name && (
              <p className="text-xs text-muted-foreground">+ {activeProtocol.blocker_name}</p>
            )}
          </div>
        </div>
      )}

      {/* Quick log */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Log Today</p>
        <div className="ios-section">
          <div className="ios-row justify-between">
            <span className="text-sm font-medium">Taken today</span>
            <button
              onClick={() => setTaken(v => !v)}
              className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${taken ? 'bg-primary' : 'bg-secondary'}`}
            >
              <span
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${taken ? 'translate-x-5' : 'translate-x-0.5'}`}
              />
            </button>
          </div>
          <div className="ios-row">
            <textarea
              placeholder="How is your body responding? (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-transparent text-sm outline-none resize-none py-1"
            />
          </div>
          <div className="ios-row justify-end">
            <button
              onClick={handleLog}
              disabled={saving}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Log'}
            </button>
          </div>
        </div>
      </div>

      {/* Recent logs */}
      {logs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Recent</p>
          <div className="ios-section">
            {logs.slice(0, 7).map((log, i) => (
              <div
                key={log.uuid}
                className={`ios-row justify-between ${i < Math.min(logs.length, 7) - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {log.taken
                      ? <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      : <X className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    }
                    <span className="text-sm font-medium truncate">{log.medication}</span>
                  </div>
                  {log.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</p>}
                </div>
                <span className="text-xs text-muted-foreground mr-3 shrink-0">{formatDate(log.logged_at)}</span>
                <button
                  onClick={() => deleteHrtLog(log.uuid)}
                  className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Protocols Tab =====

const HRT_FORMS = ['gel', 'patch', 'injection', 'oral', 'other'] as const;

function ProtocolsTab() {
  const protocols = useHrtProtocols();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [medication, setMedication] = useState('estradiol');
  const [doseDescription, setDoseDescription] = useState('');
  const [form, setForm] = useState<LocalHrtProtocol['form']>('gel');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [includeBlocker, setIncludeBlocker] = useState(false);
  const [blockerName, setBlockerName] = useState('');
  const [notes, setNotes] = useState('');

  const resetForm = () => {
    setMedication('estradiol');
    setDoseDescription('');
    setForm('gel');
    setStartedAt('');
    setEndedAt('');
    setIncludeBlocker(false);
    setBlockerName('');
    setNotes('');
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!medication || !doseDescription || !startedAt) return;
    setSaving(true);
    try {
      await createHrtProtocol({
        medication,
        dose_description: doseDescription,
        form,
        started_at: startedAt,
        ended_at: endedAt || null,
        includes_blocker: includeBlocker,
        blocker_name: includeBlocker ? (blockerName || null) : null,
        notes: notes || null,
      });
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const active = protocols.filter(p => !p.ended_at);
  const past = protocols.filter(p => !!p.ended_at);

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Active</p>
          <div className="ios-section">
            {active.map((p, i) => (
              <div
                key={p.uuid}
                className={`ios-row justify-between ${i < active.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{p.medication} — {p.dose_description}</p>
                  <p className="text-xs text-muted-foreground capitalize">{p.form} · Since {formatDate(p.started_at)}</p>
                  {p.includes_blocker && p.blocker_name && (
                    <p className="text-xs text-muted-foreground">Blocker: {p.blocker_name}</p>
                  )}
                  {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => endHrtProtocol(p.uuid)}
                    className="px-2 py-1 text-xs font-medium rounded-lg bg-secondary text-foreground"
                  >
                    End
                  </button>
                  <button
                    onClick={() => deleteHrtProtocol(p.uuid)}
                    className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add Protocol
        </button>
      ) : (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">New Protocol</p>
          <div className="ios-section space-y-0">
            <div className="ios-row gap-2">
              <input
                type="text"
                placeholder="Medication (e.g. estradiol)"
                value={medication}
                onChange={e => setMedication(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row border-t border-border gap-2">
              <input
                type="text"
                placeholder="Dose (e.g. 1g gel daily)"
                value={doseDescription}
                onChange={e => setDoseDescription(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">Form</span>
              <select
                value={form}
                onChange={e => setForm(e.target.value as LocalHrtProtocol['form'])}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right capitalize"
              >
                {HRT_FORMS.map(f => (
                  <option key={f} value={f} className="capitalize">{f}</option>
                ))}
              </select>
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">Started</span>
              <input
                type="date"
                value={startedAt}
                onChange={e => setStartedAt(e.target.value)}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              />
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">Ended (optional)</span>
              <input
                type="date"
                value={endedAt}
                onChange={e => setEndedAt(e.target.value)}
                className="text-sm text-muted-foreground bg-transparent outline-none text-right"
              />
            </div>
            <div className="ios-row border-t border-border justify-between">
              <span className="text-sm font-medium">Includes blocker</span>
              <button
                onClick={() => setIncludeBlocker(v => !v)}
                className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${includeBlocker ? 'bg-primary' : 'bg-secondary'}`}
              >
                <span
                  className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${includeBlocker ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
            {includeBlocker && (
              <div className="ios-row border-t border-border gap-2">
                <input
                  type="text"
                  placeholder="Blocker name (e.g. finasteride)"
                  value={blockerName}
                  onChange={e => setBlockerName(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
                />
              </div>
            )}
            <div className="ios-row border-t border-border gap-2">
              <input
                type="text"
                placeholder="Notes (optional)"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
            <div className="ios-row border-t border-border justify-end gap-2">
              <button
                onClick={resetForm}
                className="px-4 py-2 text-sm font-medium text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !medication || !doseDescription || !startedAt}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Past</p>
          <div className="ios-section">
            {past.map((p, i) => (
              <div
                key={p.uuid}
                className={`ios-row justify-between ${i < past.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{p.medication} — {p.dose_description}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {p.form} · {formatDate(p.started_at)} – {p.ended_at ? formatDate(p.ended_at) : ''}
                  </p>
                </div>
                <button
                  onClick={() => deleteHrtProtocol(p.uuid)}
                  className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {protocols.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground px-1">No protocols yet.</p>
      )}
    </div>
  );
}

// ===== History Tab =====

function HistoryTab() {
  const logs = useHrtLogs(90);

  if (logs.length === 0) return <p className="text-xs text-muted-foreground px-1">No history yet.</p>;

  return (
    <div className="ios-section">
      {logs.map((log, i) => (
        <div
          key={log.uuid}
          className={`ios-row justify-between ${i < logs.length - 1 ? 'border-b border-border' : ''}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
                  log.taken ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                }`}
              >
                {log.taken ? 'Taken' : 'Missed'}
              </span>
              <span className="text-sm font-medium truncate">{log.medication}</span>
            </div>
            {log.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.notes}</p>}
          </div>
          <span className="text-xs text-muted-foreground mr-3 shrink-0">{formatDate(log.logged_at)}</span>
          <button
            onClick={() => deleteHrtLog(log.uuid)}
            className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ===== Page =====

export default function HrtPage() {
  const [activeTab, setActiveTab] = useState<Tab>('today');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'protocols', label: 'Protocols' },
    { id: 'history', label: 'History' },
  ];

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-2 flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">HRT Tracking</h1>
      </div>

      {/* Tab bar */}
      <div className="px-4 pb-2">
        <div className="flex bg-secondary rounded-xl p-1 gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === t.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">
        {activeTab === 'today' && <TodayTab />}
        {activeTab === 'protocols' && <ProtocolsTab />}
        {activeTab === 'history' && <HistoryTab />}
      </div>
    </main>
  );
}
