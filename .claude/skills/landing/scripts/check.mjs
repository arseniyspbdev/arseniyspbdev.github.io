// Проверка страницы в настоящем браузере: телефон и компьютер, ошибки, вылезание вбок, битые картинки.
// Запуск из корня репозитория: node .claude/skills/landing/scripts/check.mjs demo-nails [ещё папки...]
// Скриншоты кладёт в папку из $SHOTS (по умолчанию ./.shots), с флагом --card ещё и карточку 960×600 в img/<имя>.jpg.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const args = process.argv.slice(2);
const card = args.includes('--card');
const dirs = args.filter((a) => !a.startsWith('--'));
if (!dirs.length) { console.error('Укажите папки страниц, например: demo-nails'); process.exit(2); }

const root = process.cwd();
const shots = resolve(process.env.SHOTS || '.shots');
await mkdir(shots, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }).end(await readFile(join(root, p))); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const VIEWPORTS = [['phone', 390, 844], ['desktop', 1280, 800]];
const browser = await chromium.launch();
let failed = false;

for (const dir of dirs) {
  const name = dir.replace(/\/+$/, '').replace(/^demo-/, '');
  for (const [label, width, height] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: label === 'phone' ? 2 : 1 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`ошибка JS: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`));
    page.on('requestfailed', (r) => problems.push(`не загрузилось: ${r.url()}`));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
    let bytes = 0;
    page.on('requestfinished', async (r) => { try { bytes += (await r.sizes()).responseBodySize; } catch {} });

    await page.goto(`${base}/${dir.replace(/\/+$/, '')}/`, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => problems.push(`не открылась: ${e.message}`));
    // прокрутка до конца, чтобы сработали lazy-картинки и анимации при прокрутке
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      scrollTo(0, 0);
    });
    await page.waitForTimeout(400);

    const facts = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= vw + 1) return false;
        // элементы внутри прокручиваемой ленты вылезать вправе
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return false;
        }
        return true;
      }).slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
      return {
        scrollX: document.documentElement.scrollWidth > vw + 1,
        wide,
        brokenImg: [...document.images].filter((i) => i.complete && !i.naturalWidth).map((i) => i.src),
        noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        h1: document.querySelectorAll('h1').length,
        title: document.title,
        description: !!document.querySelector('meta[name="description"]'),
        lang: document.documentElement.lang,
        meta: [['link[rel~="icon"]', 'иконки сайта (favicon)'], ['meta[property="og:image"]', 'og:image — превью ссылки в мессенджерах'], ['meta[name="theme-color"]', 'theme-color']]
          .filter(([sel]) => !document.querySelector(sel)).map(([, what]) => what),
        // русская типографика в видимом тексте
        typo: (() => {
          const found = new Map(); // вид ошибки → [сколько, пример]
          const add = (kind, t) => { const [n, ex] = found.get(kind) || [0, t.trim().slice(0, 40)]; found.set(kind, [n + 1, ex]); };
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n; (n = walker.nextNode());) {
            const el = n.parentElement;
            if (!el || el.closest('script, style, code, pre') || !el.getClientRects().length) continue;
            const t = n.textContent;
            if (/["']/.test(t)) add('прямые кавычки вместо «ёлочек»', t);
            if (/\s-\s/.test(t)) add('дефис вместо тире', t);
            if (/\.\.\./.test(t)) add('три точки вместо многоточия', t);
            if (/\d \d{3}(?!\d)/.test(t) || /\d ₽/.test(t)) add('обычный пробел в числе или перед ₽ (нужен неразрывный)', t);
          }
          return [...found].map(([kind, [n, ex]]) => `${kind}: ${n} шт., например «${ex}»`);
        })(),
        // контраст текста на сплошном фоне; текст поверх фото не проверяется — смотрите глазами
        contrast: (() => {
          const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
          const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
          const bad = new Map();
          for (const el of document.querySelectorAll('body *')) {
            if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || +cs.opacity === 0 || !el.getClientRects().length || el.closest('[aria-hidden="true"], [disabled], [aria-disabled="true"]')) continue;
            let bg = null;
            for (let p = el; p; p = p.parentElement) {
              const ps = getComputedStyle(p);
              if (ps.backgroundImage !== 'none' || p.tagName === 'IMG' || p.tagName === 'VIDEO') { bg = null; break; }
              const c = rgb(ps.backgroundColor);
              if (c.length === 3 || (c.length === 4 && c[3] >= 0.95)) { bg = c; break; }
              if (c.length === 4 && c[3] > 0) { bg = null; break; }
            }
            if (!bg) continue;
            const fg = rgb(cs.color);
            if (fg.length === 4 && fg[3] < 1) continue;
            const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
            const ratio = (a + 0.05) / (b + 0.05);
            const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.6 && +cs.fontWeight >= 700);
            if (ratio < (large ? 3 : 4.5)) bad.set(el.textContent.trim().slice(0, 30), ratio.toFixed(2));
          }
          return [...bad].slice(0, 6).map(([t, r]) => `«${t}» ${r}:1`);
        })(),
        smallTaps: [...document.querySelectorAll('a, button, input, select, [role="button"]')].filter((el) => {
          const r = el.getBoundingClientRect();
          if (el.matches('header a:first-of-type, [class*="logo"]')) return false;
          // чекбокс или радио внутри подписи: нажимают на всю подпись
          if (el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label')?.getBoundingClientRect().height >= 36) return false;
          return r.width && r.height && r.height < 36 && getComputedStyle(el).display !== 'inline' && !el.closest('nav, footer, p, li');
        }).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} «${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}» ${Math.round(el.getBoundingClientRect().height)}px`),
      };
    });

    if (facts.scrollX) problems.push(`страница едет вбок; виноваты: ${facts.wide.join(', ') || 'не нашёл'}`);
    facts.brokenImg.forEach((s) => problems.push(`битая картинка: ${s}`));
    if (facts.noAlt) problems.push(`картинок без alt: ${facts.noAlt}`);
    if (facts.h1 !== 1) problems.push(`h1 на странице: ${facts.h1}, нужен ровно один`);
    if (!facts.description) problems.push('нет meta description');
    if (facts.lang !== 'ru') problems.push(`lang="${facts.lang}", ожидался ru`);
    const warns = [];
    if (label === 'phone' && facts.smallTaps.length) warns.push(`мелко для пальца (ниже 36px): ${facts.smallTaps.join('; ')}`);
    if (label === 'desktop') {
      if (facts.meta.length) warns.push(`нет ${facts.meta.join(', ')}`);
      facts.typo.forEach((t) => warns.push(t));
      if (facts.contrast.length) warns.push(`слабый контраст: ${facts.contrast.join('; ')}`);
      const mb = bytes / 1048576;
      if (mb > 3) warns.push(`это много: ужмите фото (w=, q=) и шрифты`);
      warns.unshift(`вес страницы: ${mb.toFixed(2)} МБ`);
    }

    await page.screenshot({ path: join(shots, `${name}-${label}.png`), fullPage: true });
    if (card && label === 'desktop') {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, `${name}-card.png`) });
    }

    console.log(`${problems.length ? '✗' : '✓'} ${dir} · ${label} ${width}px · «${facts.title}»`);
    problems.forEach((p) => console.log('    ' + p));
    warns.forEach((w) => console.log('    ! ' + w));
    if (problems.length) failed = true;
    await page.close();
  }
}

if (card) {
  // карточка для главной: 1440×900 → 960×600 jpg через тот же браузер, без лишних зависимостей
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  for (const dir of dirs) {
    const name = dir.replace(/\/+$/, '').replace(/^demo-/, '');
    const png = await readFile(join(shots, `${name}-card.png`));
    await page.setContent(`<style>body{margin:0}</style><img src="data:image/png;base64,${png.toString('base64')}" width="960" height="600">`);
    await page.screenshot({ path: join(root, 'img', `${name}.jpg`), type: 'jpeg', quality: 82 });
    console.log(`  карточка: img/${name}.jpg`);
  }
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? '\nЕсть что исправить.' : '\nВсё чисто.');
console.log(`Скриншоты: ${shots} — посмотрите их глазами, скрипт не видит некрасивое.`);
process.exit(failed ? 1 : 0);
