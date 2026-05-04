// Drift test: ensures the generated Swift type list (ios/App/App/HealthKitTypes.swift)
// is in sync with the JSON source of truth (src/lib/healthkit-types.json).
//
// Why this exists: prior to centralization, ios/App/App/HealthKitPlugin.swift had a
// hand-edited type list that drifted from src/components/HealthKitPermissionsSheet.tsx
// — distanceWalkingRunning was in the TS catalog but never requested by Swift, so the
// iOS Health app never showed a toggle for it. This test catches that class of bug.
//
// Failure means: someone edited healthkit-types.json without running
// `npm run gen:healthkit`, OR hand-edited the generated Swift file.
// Fix: `npm run gen:healthkit && git add ios/App/App/HealthKitTypes.swift`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateSwift, validateCatalog } from '../../scripts/gen-healthkit-types.mjs';
import catalog from './healthkit-types.json';
import { HK_RAW_ENTRIES } from './healthkit-catalog';

const repoRoot = resolve(__dirname, '../..');
const swiftPath = resolve(repoRoot, 'ios/App/App/HealthKitTypes.swift');

describe('HealthKit type catalog drift', () => {
	it('JSON catalog has at least the required core types', () => {
		const keys = HK_RAW_ENTRIES.map((t) => t.tsKey);
		// Core types that pre-existed and must never silently disappear.
		const required = [
			'stepCount', 'activeEnergyBurned', 'basalEnergyBurned',
			'heartRate', 'heartRateVariabilitySDNN', 'restingHeartRate',
			'vo2Max', 'appleExerciseTime', 'sleepAnalysis',
			'distanceWalkingRunning', 'workout',
			'bodyMass', 'bodyFatPercentage', 'leanBodyMass', 'dietaryEnergyConsumed',
		];
		for (const key of required) {
			expect(keys, `core type ${key} missing from healthkit-types.json`).toContain(key);
		}
	});

	it('every entry has the required shape', () => {
		for (const t of HK_RAW_ENTRIES) {
			expect(t.tsKey).toMatch(/^[a-z][a-zA-Z0-9]*$/);
			expect(['quantity', 'category', 'workout', 'workoutRoute', 'medicationDoseEvent']).toContain(t.kind);
			expect(['read', 'write', 'readWrite']).toContain(t.access);
			expect(typeof t.label).toBe('string');
			expect(typeof t.blurb).toBe('string');
			expect(['clinical', 'bodycomp', 'activity', 'workouts', 'sleep', 'nutrition', 'medications']).toContain(t.category);
			if (t.kind === 'quantity' || t.kind === 'category') {
				expect(typeof t.identifier).toBe('string');
			}
		}
	});

	it('tsKeys are unique', () => {
		const keys = HK_RAW_ENTRIES.map((t) => t.tsKey);
		const set = new Set(keys);
		expect(set.size).toBe(keys.length);
	});

	it('committed Swift file matches what the generator produces from JSON', () => {
		const expected = generateSwift(catalog);
		const actual = readFileSync(swiftPath, 'utf8');
		if (actual !== expected) {
			throw new Error(
				'ios/App/App/HealthKitTypes.swift is out of date with src/lib/healthkit-types.json.\n' +
					'Run: npm run gen:healthkit && git add ios/App/App/HealthKitTypes.swift\n' +
					'(Do NOT hand-edit HealthKitTypes.swift — it is generated.)'
			);
		}
		expect(actual).toBe(expected);
	});

	it('medication type carries an iOS 26 availability gate AND a feature flag', () => {
		const med = HK_RAW_ENTRIES.find((t) => t.kind === 'medicationDoseEvent');
		expect(med, 'medicationDoseEvent entry missing').toBeDefined();
		expect(med!.iosMin).toBe('26.0');
		expect(med!.featureFlag).toBe('rebirth.medications.enabled');
	});

	it('codegen rejects strings with chars unsafe for Swift interpolation', () => {
		const dirty = { types: [{ tsKey: 'evil', kind: 'quantity', identifier: 'foo"; bar', access: 'read', label: 'X', blurb: 'X', category: 'activity' }] };
		expect(() => validateCatalog(dirty)).toThrow(/unsafe chars/);
		const cleanFlag = { types: [{ tsKey: 'foo', kind: 'quantity', identifier: 'stepCount', access: 'read', label: 'X', blurb: 'X', category: 'activity', featureFlag: 'rebirth.medications.enabled' }] };
		expect(() => validateCatalog(cleanFlag)).not.toThrow();
	});
});
