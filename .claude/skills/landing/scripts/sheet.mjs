// Лист превью фото с Unsplash, чтобы выбрать снимки глазами, а не по описанию.
// node .claude/skills/landing/scripts/sheet.mjs ids.txt лист.png
// ids.txt — по одному id на строку, часть после «photo-»: 1511201173873-c327e63eb6c4
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [list, out = 'sheet.png'] = process.argv.slice(2);
const ids = (await readFile(list, 'utf8')).split('\n').map((s) => s.trim().replace(/^photo-/, '')).filter(Boolean);

const html = `<style>body{margin:0;display:grid;grid-template-columns:repeat(8,200px);gap:4px;background:#ddd;font:12px sans-serif}
div{position:relative}img{display:block;width:200px;height:200px;object-fit:cover}b{position:absolute;left:2px;top:2px;padding:1px 4px;background:#fff}</style>` +
  ids.map((id, i) => `<div><img src="https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=400&h=400&q=60"><b>${i}</b></div>`).join('');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1640, height: 600 } });
await page.setContent(html, { waitUntil: 'networkidle' });
const broken = await page.$$eval('img', (a) => a.flatMap((img, i) => (img.naturalWidth ? [] : [i])));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
ids.forEach((id, i) => console.log(`${broken.includes(i) ? '✗' : ' '} ${i}\t${id}`));
console.log(`Лист: ${out}${broken.length ? ` · битых: ${broken.length}, их не брать` : ''}`);
