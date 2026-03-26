import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, '../public/icons/icon.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 32, name: 'favicon-32.png' },
];

for (const { size, name } of sizes) {
  const outPath = join(__dirname, '../public/icons', name);
  await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
  console.log(`Generated ${name}`);
}

// Also copy apple-touch-icon to public root
const atPath = join(__dirname, '../public/apple-touch-icon.png');
await sharp(svgBuffer).resize(180, 180).png().toFile(atPath);
console.log('Generated /public/apple-touch-icon.png');
