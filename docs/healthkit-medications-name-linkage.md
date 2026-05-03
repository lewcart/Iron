# HealthKit medications: dose → name linkage gap (iOS 26.3.1)

Status: **OPEN** — workaround shipped 2026-05-03, root cause is an Apple API
gap. Tracked in `TODOS.md` ("HealthKit medications dose-to-name linkage").

## What works today

- `HKUserAnnotatedMedicationQuery` returns the user-tracked medications with
  `nickname`, `medication.displayText`, `isArchived`, `hasSchedule`.
- `HKAnchoredObjectQuery(type: HKObjectType.medicationDoseEventType())` returns
  every dose event with timestamps, dose quantity, log status, and schedule type.
- Per-object authorization via
  `HKHealthStore.requestPerObjectReadAuthorization(for: HKObjectType.userAnnotatedMedicationType(), …)`
  works as documented and the user picks which medications to share.

## What doesn't work

There is no public way to link an `HKMedicationDoseEvent` back to its parent
`HKUserAnnotatedMedication` on iOS 26.3.1. As a result, every dose returns
`medication_name: "Unknown medication"`. Lou has 8 medications and 391 dose
events; we can show both lists but not the linkage.

## Two specific Apple API holes

### 1. `HKMedicationDoseEvent.medicationConceptIdentifier` is nil

```swift
@NSCopying var medicationConceptIdentifier: HKHealthConceptIdentifier { get }
```

The Swift signature is non-Optional, but the property returns nil for every
dose we observed. Confirmed via KVC:

```swift
let raw = (dose as NSObject).value(forKey: "medicationConceptIdentifier")
// raw == nil for all 391 doses
```

Reflection on the property (`String(reflecting:)` or `type(of:)`) crashes the
process with `EXC_BAD_ACCESS` in `swift_getObjectType` because Swift dereferences
the nil pointer believing it's non-Optional. Captured crash log:
`/tmp/rebirth-crashes/App-2026-05-03-145555.ips`.

### 2. `HKUserAnnotatedMedication` exposes no UUID

ObjC runtime introspection (`class_copyPropertyList` walking up to NSObject):

```
[HKUserAnnotatedMedication]
  nickname             — String?
  isArchived           — Bool
  hasSchedule          — Bool
  medication           — HKMedicationConcept
[NSObject]
  hash, superclass, description, debugDescription
```

There is no `uuid`, no `syncIdentifier`, no `metadata`. The class does NOT
inherit from `HKObject` — it inherits directly from `NSObject` — so the usual
HK sample machinery is unavailable.

`HKMedicationConcept` (the `medication` property) also has no UUID; only
`displayText`, `generalForm`, `identifier` (HKHealthConceptIdentifier),
and `relatedCodings`.

## What we tried

| Attempt | Result |
|---------|--------|
| Map by `med.medication.identifier` (HKHealthConceptIdentifier) → dose's `medicationConceptIdentifier` | Dose's identifier is nil. No matches. |
| Map by `String(describing:)` of the concept identifier (avoid NSObject identity-based hashing) | Same — dose-side stringifies to "" because nil |
| Map by `med.uuid.uuidString` (HKObject base) | `HKUserAnnotatedMedication` has no `uuid` property, compile error |
| KVC fishing on `med` for `uuid`, `syncIdentifier`, `medicationUUID`, `objectUUID`, `medicationIdentifier` | None present (verified via property-list walk) |
| Parse the dose's `HKMetadataKeySyncIdentifier` (format: `"medication\|█\|0\|█\|UUID\|█\|<UUID>_<timestamp>"`) | UUID extracts cleanly, but we have no matching UUID on the medication side to look it up against |
| Inspect `dose.metadata` for medication-name metadata | Metadata only contains `HKMetadataKeySyncIdentifier` and `HKMetadataKeySyncVersion` — no name |

## What to try next

Listed in rough order of "most likely to work" and "least disruptive."

### A. `HKUserAnnotatedMedicationQueryDescriptor` (Swift Concurrency)

iOS 18+ introduced descriptor-based queries that may expose richer joins.
Check whether iterating `for try await med in HKUserAnnotatedMedicationQueryDescriptor(...).results(for: store)` gives access to `med.uuid` or a related predicate that filters dose events. If yes, we can either:

- Discover a UUID-bearing accessor that the legacy `HKUserAnnotatedMedicationQuery` hides, or
- Query dose events scoped to a specific medication (per-medication anchored query).

Estimated effort: ~1 hour to prototype, ~2 hours to wire into `fetchMedicationRecords` if it works.

### B. Per-medication dose query with predicate

Apple may have added `HKQuery.predicateForObjects(from: HKUserAnnotatedMedication)`
or similar. If so, run N queries (one per medication) and tag results with the
medication's name at fetch time. N is small (Lou has 8). Investigate via:

```bash
# Get the full list of HKQuery factory methods
curl -sSL "https://developer.apple.com/tutorials/data/documentation/healthkit/hkquery.json" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); ..."
```

### C. Filter the syncIdentifier UUID against medication-side metadata

If a SECOND query (e.g. a low-level `HKAnchoredObjectQuery` filtered for
medication entities, or a `HKSampleQuery` for some opaque internal sample
type) returns `HKUserAnnotatedMedication`-related samples WITH metadata
exposing a UUID, we can match those UUIDs to the dose's syncIdentifier UUID.
Speculative; depends on internal HK implementation details.

### D. File a Feedback Assistant report

Even if A or B works, the public Swift API gap should be reported to Apple.
File via Feedback Assistant with:

- Sample code reproducing `dose.medicationConceptIdentifier == nil` despite non-Optional
- Sample code showing `HKUserAnnotatedMedication` lacks a UUID
- Crash log demonstrating the dyld vulnerability when the nil property is reflected
- Request: either make `medicationConceptIdentifier` truly non-Optional, OR add a
  `HKUserAnnotatedMedication.uuid` property, OR document the per-object query path

### E. Wait for iOS 26.4

Apple ships ~quarterly point releases. Re-test on iOS 26.4 betas as they appear.
Re-running `fetchMedicationRecords` on a fresh build is cheap; retest takes
under 5 minutes.

## How to reproduce

1. Check out a branch from main, build to a real iPhone (not simulator) running
   iOS 26+: `npm run ios:device`.
2. From Safari Web Inspector connected to the WKWebView:
   ```js
   await Capacitor.Plugins.HealthKit.setMedicationsEnabled({ enabled: true });
   // Approve the per-object auth sheet on the device
   const r = await Capacitor.Plugins.HealthKit.fetchMedicationRecords({
     startTime: Date.now() - 90 * 24 * 60 * 60 * 1000,
     endTime: Date.now(),
   });
   console.log({
     namedMeds: r.annotatedMedications.length,
     doseEvents: r.medications.length,
     anyNamed: r.medications.find(m => m.medication_name !== 'Unknown medication'),
   });
   ```
3. Expected today: `namedMeds = 8`, `doseEvents = 391` (varies),
   `anyNamed = undefined`. The day `anyNamed` returns a real dose, this gap is closed.

## Related code

- `ios/App/App/HealthKitPlugin.swift::fetchMedicationRecords` — the live code path
- `src/lib/healthkit.ts::MedicationRecord, AnnotatedMedication` — TS interfaces
- `src/features/health/healthSync.ts` — caller; consume `annotatedMedications`
  to render the medication list separately from dose events
- Crash log of the `String(reflecting:)` attempt:
  `/tmp/rebirth-crashes/App-2026-05-03-145555.ips`
