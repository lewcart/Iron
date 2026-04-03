/**
 * Export all required icon sizes from icon.svg
 *
 * iOS:   AppIcon.appiconset — 1024x1024 (the only size Xcode needs for modern iOS)
 * Web:   apple-touch-icon.png (180), favicon-32.png (32), icons/icon-192.png, icons/icon-512.png
 * OG:    og-image.png — 1200x630 with icon centered on gradient background
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgBuf = readFileSync(path.join(root, 'public/icon.svg'));

function svgAt(size, padding = 0) {
  // Render SVG at target size with optional padding (for app icon safe area)
  const canvas = size;
  const iconSize = Math.round(size * (1 - padding * 2));
  const offset = Math.round(size * padding);
  return sharp(svgBuf, { density: Math.ceil((size / 512) * 72 * 4) })
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: offset, bottom: offset, left: offset, right: offset,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
}

// App icon with rounded square white background + trans gradient
async function appIcon(size) {
  const radius = Math.round(size * 0.22); // iOS-style corner radius
  // Build rounded-rect SVG background with trans flag diagonal gradient
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#5BCEFA"/>
        <stop offset="100%" stop-color="#F5A9B8"/>
      </linearGradient>
      <clipPath id="clip">
        <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/>
      </clipPath>
    </defs>
    <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
  </svg>`;

  const butterfly = await sharp(svgBuf, { density: Math.ceil((size / 512) * 288) })
    .resize(Math.round(size * 0.8), Math.round(size * 0.8), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const margin = Math.round(size * 0.1);
  return sharp(Buffer.from(bgSvg))
    .composite([{ input: butterfly, top: margin, left: margin }])
    .png();
}

async function main() {
  console.log('Exporting icons from icon.svg...\n');

  // ── iOS: 1024×1024 app icon (no background — Xcode adds its own container)
  const iosDir = path.join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  await (await appIcon(1024)).toFile(path.join(iosDir, 'AppIcon-512@2x.png'));
  console.log('✓ iOS   AppIcon-512@2x.png (1024×1024)');

  // ── Web: apple-touch-icon 180×180 (white bg, no rounded corners — iOS adds them)
  const publicDir = path.join(root, 'public');
  await (await appIcon(180)).toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('✓ Web   apple-touch-icon.png (180×180)');

  // ── Web: favicon 32×32 (transparent background, just the butterfly)
  mkdirSync(path.join(publicDir, 'icons'), { recursive: true });
  await svgAt(32, 0.04).png().toFile(path.join(publicDir, 'icons/favicon-32.png'));
  console.log('✓ Web   icons/favicon-32.png (32×32)');

  // ── PWA: icon-192
  await (await appIcon(192)).toFile(path.join(publicDir, 'icons/icon-192.png'));
  console.log('✓ PWA   icons/icon-192.png (192×192)');

  // ── PWA: icon-512
  await (await appIcon(512)).toFile(path.join(publicDir, 'icons/icon-512.png'));
  console.log('✓ PWA   icons/icon-512.png (512×512)');

  // ── OG image: 1200×630, icon centred on gradient background
  const ogBg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <linearGradient id="og" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#5BCEFA"/>
        <stop offset="100%" stop-color="#F5A9B8"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#og)"/>
  </svg>`;
  const ogIcon = await sharp(svgBuf, { density: 288 })
    .resize(400, 400, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(Buffer.from(ogBg))
    .composite([{ input: ogIcon, top: 115, left: 400 }])
    .png()
    .toFile(path.join(publicDir, 'og-image.png'));
  console.log('✓ OG    og-image.png (1200×630)');

  // ── Preview copies (for verification)
  await (await appIcon(512)).toFile(path.join(__dirname, 'icon-preview-app-512.png'));
  await svgAt(60, 0.06).png().toFile(path.join(__dirname, 'icon-preview-60.png'));
  await svgAt(29, 0.06).png().toFile(path.join(__dirname, 'icon-preview-29.png'));
  await svgAt(20, 0.06).png().toFile(path.join(__dirname, 'icon-preview-20.png'));
  console.log('\n✓ Preview files in scripts/ for verification');

  console.log('\nAll icons exported successfully.');
}

main().catch(err => { console.error(err); process.exit(1); });
