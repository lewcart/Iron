// Adapter over src/lib/healthkit-types.json for TS consumers.
// The JSON is the single source of truth — same file generates the Swift
// type list via scripts/gen-healthkit-types.mjs. Drift between TS and Swift
// is structurally impossible.

import catalog from './healthkit-types.json';

export interface HKTypeRow {
	statusKey: string;
	label: string;
	blurb: string;
	read: boolean;
	write: boolean;
	category: 'clinical' | 'bodycomp' | 'activity' | 'workouts' | 'sleep' | 'nutrition' | 'medications';
	iosMin: string | null;
	featureFlag: string | null;
}

interface CatalogEntry {
	tsKey: string;
	kind: 'quantity' | 'category' | 'workout' | 'medicationDoseEvent';
	identifier?: string;
	access: 'read' | 'write' | 'readWrite';
	label: string;
	blurb: string;
	iosMin?: string;
	featureFlag?: string;
	category: HKTypeRow['category'];
}

const entries = (catalog as { types: CatalogEntry[] }).types;

export const HK_TYPES: HKTypeRow[] = entries.map((t) => ({
	statusKey: t.tsKey,
	label: t.label,
	blurb: t.blurb,
	read: t.access === 'read' || t.access === 'readWrite',
	write: t.access === 'write' || t.access === 'readWrite',
	category: t.category,
	iosMin: t.iosMin ?? null,
	featureFlag: t.featureFlag ?? null,
}));

/// Type identifiers in the canonical order, used by drift tests and
/// any code that needs to enumerate types deterministically.
export const HK_TS_KEYS: string[] = entries.map((t) => t.tsKey);

/// Raw JSON entries, exported for the drift test only. Don't use this for UI.
export const HK_RAW_ENTRIES: ReadonlyArray<Readonly<CatalogEntry>> = entries;
