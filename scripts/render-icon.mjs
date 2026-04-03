import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'public/icon.svg');
const svgBuf = readFileSync(svgPath);

// Render at 512x512 for inspection
await sharp(svgBuf, { density: 192 })
  .resize(512, 512)
  .png()
  .toFile(path.join(root, 'scripts/icon-preview-512.png'));

console.log('Rendered: scripts/icon-preview-512.png');
