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
  workboxOptions: {
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
    ],
  },
})(nextConfig);
