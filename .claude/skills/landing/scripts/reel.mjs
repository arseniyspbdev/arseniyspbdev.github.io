// Ролик-превью работы для портфолио: плавное видео даже с тяжёлым 3D.
// Часы страницы (performance.now, Date.now, requestAnimationFrame, таймеры) подменяются и двигаются вручную ровно на 1/FPS секунды между снимками,
// (page.clock не подходит: он замораживает и сам скриншот)
// поэтому медленная программная отрисовка не делает видео рваным.
//
// node .claude/skills/landing/scripts/reel.mjs <папка-демо> <сценарий.json> <выход без расширения>
// Сценарий: { "w": 1280, "h": 800, "seconds": 8, "fps": 30, "warm": 3000,
//             "steps": [ { "at": 1.2, "click": "[data-shape=jug]" }, { "at": 3, "scroll": 0.4 }, { "at": 5, "drag": [x0, y0, x1, y1, 0.8] } ] }
//   click — селектор; scroll — доля высоты страницы (плавно за 1,2 с) или { "to": "#id" };
//   scroll { "y": "выражение JS" } — прокрутить к вычисленной точке; out — ширина видео (по умолчанию 960)
//   drag — тянуть мышью из (x0,y0) в (x1,y1) за N секунд (доли экрана 0…1); eval — код в странице.
// 3D-ролики пишите по одному: два параллельных на программной отрисовке не успевают.
// Получается <выход>.mp4 (H.264, для всех браузеров), <выход>.webm (VP9, легче) и <выход>.jpg — постер.
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [dir, scenarioPath, outBase] = process.argv.slice(2);
const sc = { w: 1280, h: 800, seconds: 8, fps: 30, warm: 3000, out: 960, steps: [], ...JSON.parse(await readFile(scenarioPath, 'utf8')) };

const root = process.cwd();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }).end(await readFile(join(root, p))); }
  catch { res.writeHead(404).end(); }
}).listen(0);

const frames = join(tmpdir(), 'reel-' + process.pid);
await mkdir(frames, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: sc.w, height: sc.h } });
page.on('pageerror', (e) => console.log('ошибка JS:', e.message));
// плавная прокрутка CSS идёт в реальном времени и рвёт кадры — выключаем, прокручиваем сами
await page.addInitScript(() => addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'html, body { scroll-behavior: auto !important; }'; document.head.append(st); }));
await page.addInitScript(() => {
  let vt = 0, ids = 1;
  const t0 = Date.now(), raf = new Map(), timers = new Map();
  performance.now = () => vt;
  Date.now = () => t0 + vt;
  window.requestAnimationFrame = (cb) => { const id = ids++; raf.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => raf.delete(id);
  window.setTimeout = (cb, ms = 0, ...a) => { const id = ids++; timers.set(id, { at: vt + Math.max(0, +ms || 0), cb: () => (typeof cb === 'function' ? cb(...a) : 0) }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = (cb, ms = 0) => { const id = ids++; const tick = () => { cb(); if (timers.has(id)) timers.set(id, { at: vt + ms, cb: tick }); }; timers.set(id, { at: vt + ms, cb: tick }); return id; };
  window.clearInterval = window.clearTimeout;
  // шаг виртуального времени: таймеры срабатывают по порядку, а кадр анимации — один на шаг.
  // Больше кадров на шаг нельзя: 3D-отрисовки копятся в очереди видеокарты, и скриншот ждёт их вечно
  window.__advance = (ms) => {
    const end = vt + ms;
    while (vt < end) {
      vt = Math.min(end, vt + 1000 / 120);
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= vt) { timers.delete(id); try { t.cb(); } catch (e) { console.error(e); } }
    }
    const now = [...raf]; raf.clear();
    for (const [, cb] of now) { try { cb(vt); } catch (e) { console.error(e); } }
  };
});
await page.goto(`http://127.0.0.1:${server.address().port}/${dir.replace(/\/+$/, '')}/`, { waitUntil: 'networkidle' });
// разогрев: шрифты, картинки и стартовые анимации
for (let t = 0; t < sc.warm; t += 50) { await page.evaluate(() => window.__advance(50)); await page.waitForTimeout(60); }

const dt = 1000 / sc.fps, total = Math.round(sc.seconds * sc.fps);
const steps = sc.steps.map((s) => ({ ...s, frame: Math.round(s.at * sc.fps) }));
const drags = [];
for (let f = 0; f < total; f++) {
  for (const s of steps.filter((x) => x.frame === f)) {
    // нажатие отправляем прямо в элемент: page.click сначала прокручивает к нему страницу, и кадры рвутся
    if (s.click) await page.locator(s.click).first().dispatchEvent('click', {}, { timeout: 5000 }).catch((e) => console.log('click:', e.message));
    if (s.eval) await page.evaluate(s.eval);
    if (s.scroll !== undefined) {
      const to = await page.evaluate((v) => (typeof v === 'object' ? (v.y ? (0, eval)(v.y) : document.querySelector(v.to).getBoundingClientRect().top + scrollY) : v * (document.documentElement.scrollHeight - innerHeight)), s.scroll);
      const from = await page.evaluate(() => scrollY);
      drags.push({ kind: 'scroll', from, to, f0: f, f1: f + Math.round((s.dur || 1.2) * sc.fps) });
    }
    if (s.drag) {
      const [x0, y0, x1, y1, d] = s.drag;
      await page.mouse.move(x0 * sc.w, y0 * sc.h); await page.mouse.down();
      drags.push({ kind: 'drag', x0, y0, x1, y1, f0: f, f1: f + Math.round(d * sc.fps) });
    }
  }
  let scrolled = false;
  for (const d of drags) {
    if (f < d.f0 || f > d.f1) continue;
    if (d.kind === 'scroll') scrolled = true;
    const k = (f - d.f0) / Math.max(1, d.f1 - d.f0), e = k < .5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    if (d.kind === 'scroll') await page.evaluate((y) => window.scrollTo(0, y), d.from + (d.to - d.from) * e);
    else { await page.mouse.move((d.x0 + (d.x1 - d.x0) * e) * sc.w, (d.y0 + (d.y1 - d.y0) * e) * sc.h); if (f === d.f1) await page.mouse.up(); }
  }
  await page.evaluate((ms) => window.__advance(ms), dt);
  // после прокрутки браузер дорисовывает страницу не сразу — без паузы в кадре склеиваются две позиции
  if (scrolled) await page.waitForTimeout(250);
  await page.screenshot({ path: join(frames, String(f).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92, timeout: 180000 });
}
await browser.close();
server.close();

const out = resolve(outBase);
const input = ['-y', '-loglevel', 'error', '-framerate', String(sc.fps), '-i', join(frames, '%05d.jpg'), '-vf', `scale=${sc.out}:-2:flags=lanczos`];
execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', '-an', out + '.mp4']);
execFileSync('ffmpeg', [...input, '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-row-mt', '1', '-an', out + '.webm']);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(frames, String(Math.round(total * (sc.poster ?? .7))).padStart(5, '0') + '.jpg'), '-vf', `scale=${sc.out}:-2:flags=lanczos`, '-q:v', '4', out + '.jpg']);
await rm(frames, { recursive: true });
console.log(`готово: ${out}.mp4, .webm, .jpg`);
