## iPad — future work (deferred from 2026-04-20 web-first pivot)

- [ ] If iPad usage is real, evaluate native universal binary + one wedge feature
      (Pencil on progress photos OR InBody scan scrub-compare OR weekly review cockpit)
- [ ] If going native: update FitspoControlExtension + RestTimerLiveActivity
      device family to 1,2 for widget parity
- [ ] Consider Stage Manager / keyboard shortcut / macOS Catalyst surfaces at that point
- [ ] Chart enrichment polish round — currently added reference lines + multi-site overlay
      at lg:+; consider making trend metric selectable (weight, SMM, BMR) rather than hardcoded PBF%
- [ ] ios-section / ios-row standardization — both reviewers flagged as visual debt,
      out of scope for the 2026-04-20 iPad pass
- [ ] Success metric before graduating to native: N weekly iPad sessions, mostly on
      /measurements or /body-spec

## UI polish

- [ ] Inspo capture button icon — replace the Camera icon (src/components/InspoCaptureButton.tsx,
      set in commit d60cecc) with a muscle / flex icon (Lucide has no native "flex" — consider
      Dumbbell, or revert to 💪 emoji, or build a small custom SVG). Camera reads too "take a
      photo of my food" and not "fitspo inspiration burst."
