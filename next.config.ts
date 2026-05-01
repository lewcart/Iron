import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  ...(process.env.CAPACITOR_BUILD === "1" ? { output: "export" } : {}),
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
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
