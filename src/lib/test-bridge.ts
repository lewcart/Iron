// E2E test bridge — only loaded when built with NEXT_PUBLIC_E2E=1.
//
// Production safety:
// 1. providers.tsx imports this dynamically inside an env-flag conditional.
//    Next/webpack DCE elides the entire branch when the flag is unset.
// 2. scripts/check-no-test-bridge.sh greps `out/` for `__rebirthTestBridge`
//    and fails the build if found in a prod bundle. Belt and braces.
//
// API contract (consumed by .maestro/helpers/*.yaml via Maestro evalScript):
//   await window.__rebirthTestBridge.ready()
//   await window.__rebirthTestBridge.reset()
//   await window.__rebirthTestBridge.seed('workout-with-3-sets')
//        window.__rebirthTestBridge.setClock('2026-05-01T08:00:00+01:00')
//        window.__rebirthTestBridge.getTree()

import { db } from '@/db/local';
import * as nowProvider from '@/lib/now-provider';

export interface RebirthTestBridge {
  ready: () => Promise<void>;
  reset: () => Promise<void>;
  seed: (name: string) => Promise<void>;
  setClock: (iso: string | null) => void;
  getTree: () => unknown;
}

declare global {
  interface Window {
    __rebirthTestBridge?: RebirthTestBridge;
  }
}

export function mountTestBridge(): void {
  // Dead-code-eliminate the entire body in non-E2E builds. SWC inlines
  // `process.env.NEXT_PUBLIC_E2E` to its build-time value, so when the
  // flag is unset this becomes `'undefined' !== '1'` → unconditional early
  // return → SWC eliminates everything below. Webpack then tree-shakes
  // `db`, `nowProvider`, the `Dexie` dynamic import, the `getTree` DOM
  // walk — none of it enters the prod bundle. The `__rebirthTestBridge`
  // string literal disappears with the dead code.
  //
  // scripts/check-no-test-bridge.sh greps the static export for
  // `__rebirthTestBridge` as a belt-and-braces guard.
  if (process.env.NEXT_PUBLIC_E2E !== '1') return;

  if (typeof window === 'undefined') return;
  if (window.__rebirthTestBridge) return;

  window.__rebirthTestBridge = {
    ready: async () => {
      // Resolves once Dexie is open. The launch.yaml flow follows up with
      // an `assertVisible: "Week"` to confirm first paint with data.
      await db.open();
    },

    reset: async () => {
      // Drop everything: Dexie + localStorage + sessionStorage. Reload
      // so React tree boots clean. Bridge re-mounts itself on next
      // providers.tsx run.
      //
      // Race note: syncEngine, hydrateExercises, useLiveQuery subscribers
      // can be mid-flight when this runs. Dexie.close() rejects in-flight
      // transactions but live subscribers can throw. The window.location
      // .reload() at the end tears the React tree down regardless, so the
      // worst case is a flicker. If flow timing becomes flaky here, the
      // fix is to stop the syncEngine + clear queryClient first.
      try {
        await db.close();
      } catch {
        // Already closed; carry on.
      }
      // Use the existing Dexie instance's own delete() rather than
      // hardcoding the database name — keeps the bridge in sync if the
      // name ever changes in src/db/local.ts.
      try {
        await db.delete();
      } catch {
        // Fall through to reload — anything left in IndexedDB will be
        // overwritten on next open(), and storage is cleared below.
      }
      try {
        window.localStorage.clear();
      } catch {
        // Some browsers throw on storage access in strict modes; ignore.
      }
      try {
        window.sessionStorage.clear();
      } catch {
        // Same.
      }
      window.location.reload();
    },

    seed: async (name: string) => {
      // Fixture loader. Each fixture exports an async `apply()` from
      // src/lib/test-fixtures/<name>.ts. Throws if not found.
      const fixtures = await import('./test-fixtures');
      await fixtures.applyFixture(name);
    },

    setClock: (iso) => {
      nowProvider.setNow(iso);
    },

    getTree: () => walkAccessibilityTree(document.body),
  };
}

// Walks the DOM producing a compact a11y-flavoured snapshot. Surfaced via
// `npm run test:maestro:tree -- /route` so selector authoring (human or CC)
// can grep the live tree instead of guessing.
//
// Each node: {tag, role?, name?, text?, id?, children}
//   - role:   from `role` attr or implicit (button, link, etc.)
//   - name:   aria-label or text content (truncated)
//   - text:   own text node content (no descendants)
//   - id:     `id` attr (if present and starts with `m-`, flagged for selector use)
type TreeNode = {
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  id?: string;
  children: TreeNode[];
};

function walkAccessibilityTree(node: Element, depth = 0): TreeNode {
  if (depth > 40) return { tag: 'truncated', children: [] };

  const tag = node.tagName.toLowerCase();
  const role = node.getAttribute('role') || implicitRole(tag);
  const ariaLabel = node.getAttribute('aria-label');
  const id = node.getAttribute('id') || undefined;
  const ownText = ownTextOf(node);

  const out: TreeNode = {
    tag,
    children: [],
  };
  if (role) out.role = role;
  if (ariaLabel) out.name = truncate(ariaLabel, 80);
  else if (ownText) out.name = truncate(ownText, 80);
  if (ownText) out.text = truncate(ownText, 80);
  if (id) out.id = id;

  for (const child of Array.from(node.children)) {
    if (isVisible(child)) {
      out.children.push(walkAccessibilityTree(child, depth + 1));
    }
  }
  return out;
}

function ownTextOf(node: Element): string {
  let s = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      s += child.textContent ?? '';
    }
  }
  return s.trim();
}

function implicitRole(tag: string): string | undefined {
  const map: Record<string, string> = {
    button: 'button',
    a: 'link',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    input: 'textbox',
    textarea: 'textbox',
    select: 'combobox',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
  };
  return map[tag];
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') === 'true') return false;
  return true;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
