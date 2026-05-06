import type { NextConfig } from "next";
import path from "node:path";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  // Pin file tracing + workspace root to this directory. Without it, when
  // running inside a git worktree under .claude/worktrees, Next.js infers
  // the parent repo as the workspace root and module resolution can pick
  // a duplicate copy of react from there — triggering "useInsertionEffect
  // is null" in dev. Anchoring to __dirname keeps everything inside this
  // tree consistent across worktrees and the main checkout.
  outputFileTracingRoot: path.resolve(__dirname),
  ...(process.env.CAPACITOR_BUILD === "1" ? { output: "export" } : {}),
};

export default withPWA({
  dest: "public",
  // Disable the service worker for Capacitor (iOS) builds. The whole bundle
  // is already on local disk inside the .ipa, so an extra Workbox cache
  // layer adds no offline benefit — it just creates a stale-asset trap.
  // After a new install, the old SW (still registered in WKWebView) would
  // intercept fetches for `index.html` / `_next/static/*` and serve last
  // build's HTML pointing to last build's chunk hashes, so newly shipped
  // features (MuscleMap on the exercise page, ✨ Steps/Tips/About generator,
  // etc.) wouldn't render until the user force-quit twice. PWA stays on
  // for the web/Vercel deploy where the SW does real work.
  disable:
    process.env.NODE_ENV === "development" ||
    process.env.CAPACITOR_BUILD === "1",
  fallbacks: {
    document: "/offline",
  },
  // Don't precache the bundled exercise images on first install — that
  // would push the SW install size past 70MB. Instead they're cached
  // on first view via the runtimeCaching rule below.
  workboxOptions: {
    exclude: [/exercise-images\/.*/],
    runtimeCaching: [
      {
        urlPattern: /\/_next\/static\/.*/,
        handler: "CacheFirst",
        options: {
          cacheName: "static-resources",
          expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      /* Catalog only — user-specific API responses are cached in TanStack Query, not Workbox. */
      {
        urlPattern: /\/api\/exercises/,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "exercises-api",
          expiration: { maxEntries: 20, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /\/icons\/.*/,
        handler: "CacheFirst",
        options: {
          cacheName: "icons",
          expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      /* Bundled exercise demo frames — fetched on-view, cached aggressively.
         Lewis's most-used 50 exercises will stay in cache after one open;
         the long tail loads on demand without bloating SW install. */
      {
        urlPattern: /\/exercise-images\/.*\.jpe?g/i,
        handler: "CacheFirst",
        options: {
          cacheName: "exercise-images",
          expiration: { maxEntries: 2500, maxAgeSeconds: 90 * 24 * 60 * 60 },
        },
      },
      /* AI-generated demo frames live on Vercel Blob. Same caching strategy. */
      {
        urlPattern: /^https:\/\/.*\.public\.blob\.vercel-storage\.com\/exercise-images\/.+/i,
        handler: "CacheFirst",
        options: {
          cacheName: "exercise-images-blob",
          expiration: { maxEntries: 1000, maxAgeSeconds: 90 * 24 * 60 * 60 },
        },
      },
    ],
  },
})(nextConfig);
