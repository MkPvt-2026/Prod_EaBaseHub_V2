// =====================================================
// build-static.mjs
// เว็บนี้เป็น static multi-page (สคริปต์แบบ <script src> ธรรมดา)
// `vite build` จะ bundle แค่ index.html และไม่คัดลอก /pages /js /css
// สคริปต์นี้จึงคัดลอกไฟล์ทั้งหมดที่ต้อง deploy ไปไว้ใน dist/
// =====================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const INCLUDE = [
  'index.html', 'UnderDev.html', 'commingSoon.html',
  'manifest.json', 'sw.js',
  'assets', 'css', 'js', 'pages',
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let count = 0;
for (const item of INCLUDE) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(dist, item), { recursive: true });
  count++;
}
console.log(`✅ static build done → dist/ (${count} entries copied)`);
