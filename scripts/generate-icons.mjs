import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');
const androidResDir = join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const svg = readFileSync(join(iconsDir, 'icon.svg'));
const svgForeground = readFileSync(join(iconsDir, 'icon-foreground.svg'));

/** Zone sûre adaptive icon Android (~66 % du canvas 108dp) */
const ADAPTIVE_SAFE_RATIO = 0.58;

async function pngFromSvg(source, size) {
  return sharp(source).resize(size, size).png().toBuffer();
}

async function pngWithPadding(source, size, fillRatio = ADAPTIVE_SAFE_RATIO) {
  const innerSize = Math.round(size * fillRatio);
  const offset = Math.round((size - innerSize) / 2);
  const inner = await sharp(source).resize(innerSize, innerSize).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: inner, left: offset, top: offset }])
    .png()
    .toBuffer();
}

for (const size of [192, 512]) {
  const png = await pngFromSvg(svg, size);
  writeFileSync(join(iconsDir, `icon-${size}.png`), png);
  console.log(`Generated icon-${size}.png`);
}

const androidIcons = [
  { folder: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { folder: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { folder: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { folder: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { folder: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

for (const { folder, launcher, foreground } of androidIcons) {
  const dir = join(androidResDir, folder);
  mkdirSync(dir, { recursive: true });

  const launcherPng = await pngWithPadding(svg, launcher, 0.72);
  writeFileSync(join(dir, 'ic_launcher.png'), launcherPng);
  writeFileSync(join(dir, 'ic_launcher_round.png'), launcherPng);
  console.log(`Generated android/${folder}/ic_launcher.png`);

  const foregroundPng = await pngWithPadding(svgForeground, foreground, ADAPTIVE_SAFE_RATIO);
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), foregroundPng);
  console.log(`Generated android/${folder}/ic_launcher_foreground.png`);
}
