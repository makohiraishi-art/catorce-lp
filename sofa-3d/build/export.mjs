/**
 * export.mjs — ヘッドレスChromiumでソファモデルをレンダリングし、
 * renders/*.png(4方向)と sofa.glb(3Dデータ)を生成する。
 *
 *   node build/export.mjs   (sofa-3d/ ディレクトリから実行)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8077;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png',
};

// sofa-3d/ を配信する簡易静的サーバ
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// Chromium 実行ファイルを探す
function findChromium() {
  const candidates = [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    ...fs.globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Chromium not found under /opt/pw-browsers');
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 940, height: 940 } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/build/page.html`);
await page.waitForFunction('window.READY === true', null, { timeout: 30000 });

fs.mkdirSync(path.join(ROOT, 'renders'), { recursive: true });
for (const view of ['front', 'angle', 'side', 'back']) {
  const dataUrl = await page.evaluate((v) => window.api.shot(v), view);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ROOT, 'renders', `${view}.png`), png);
  console.log(`renders/${view}.png  (${(png.length / 1024).toFixed(0)} KB)`);
}

const glb = Buffer.from(await page.evaluate(() => window.api.exportGLB()), 'base64');
fs.writeFileSync(path.join(ROOT, 'sofa.glb'), glb);
console.log(`sofa.glb  (${(glb.length / 1024).toFixed(0)} KB)`);

await browser.close();
server.close();
