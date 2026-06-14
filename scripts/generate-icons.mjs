import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');
const androidResDir = join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const svg = readFileSync(join(iconsDir, 'icon.svg'));

for (const size of [192, 512]) {
  const png = await sharp(svg).resize(size, size).png().toBuffer();
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

  for (const [name, size] of [
    ['ic_launcher', launcher],
    ['ic_launcher_round', launcher],
    ['ic_launcher_foreground', foreground],
  ]) {
    const png = await sharp(svg).resize(size, size).png().toBuffer();
    writeFileSync(join(dir, `${name}.png`), png);
    console.log(`Generated android/${folder}/${name}.png`);
  }
}
