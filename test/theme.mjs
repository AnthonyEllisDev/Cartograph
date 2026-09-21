import { launch, base as baseUrl, ready, newMap } from './browser.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(baseUrl('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Theme Workbench', kind: 'region' });

const css = (name) => p.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const ok = [], bad = [];
const t = (label, cond, extra='') => (cond ? ok : bad).push(label + (extra ? ' — ' + extra : ''));

await p.click('.tab[data-tab="settings"]');
await p.waitForTimeout(400);
const cards = await p.$$('.theme-card');
t('theme cards present (' + cards.length + ')', cards.length >= 5);
const swatches = await p.$$('.swatches .swatch');
t('accent swatches present (' + swatches.length + ')', swatches.length >= 4);

const base = await css('--bg');

// vellum theme (dark parchment)
await p.click('.theme-card:has-text("Vellum")');
await p.waitForTimeout(300);
const vell = await css('--bg');
t('vellum changes --bg', vell !== base, base + ' -> ' + vell);
t('vellum stays dark-mode', !(await p.evaluate(() => document.body.classList.contains('is-light'))));
await p.screenshot({ path: '/tmp/shots/theme-vellum-settings.png' });
await p.click('.tab[data-tab="map"]'); await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/shots/theme-vellum-map.png' });

// daylight is the light one
await p.click('.tab[data-tab="settings"]'); await p.waitForTimeout(300);
await p.click('.theme-card:has-text("Daylight")'); await p.waitForTimeout(300);
t('daylight sets light body class', await p.evaluate(() => document.body.classList.contains('is-light')));
await p.click('.tab[data-tab="map"]'); await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/shots/theme-daylight-map.png' });
await p.click('.tab[data-tab="settings"]'); await p.waitForTimeout(300);
await p.click('.theme-card:has-text("Vellum")'); await p.waitForTimeout(250);

// accent
await p.click('.tab[data-tab="settings"]'); await p.waitForTimeout(300);
const accentBefore = await css('--accent');
await p.evaluate(() => { const s = document.querySelectorAll('.swatches .swatch'); s[s.length-1].click(); });
await p.waitForTimeout(250);
t('accent changes', (await css('--accent')) !== accentBefore, accentBefore + ' -> ' + (await css('--accent')));

// selects: scale, rail side, backdrop, rounding
const setSel = async (label, value) => p.evaluate(([lab, val]) => {
  const f = Array.from(document.querySelectorAll('#settings-body .field'))
    .find(x => x.querySelector('label') && x.querySelector('label').textContent.trim() === lab);
  if (!f) throw new Error('no field ' + lab);
  const s = f.querySelector('select');
  s.value = String(val); s.dispatchEvent(new Event('change', { bubbles: true }));
}, [label, value]);

const fs = () => p.evaluate(() => document.documentElement.style.fontSize);
await setSel('Interface scale', 125); await p.waitForTimeout(250);
t('ui scale applies', (await fs()) === '16.25px', 'font-size=' + await fs());
await setSel('Interface scale', 100); await p.waitForTimeout(200);
t('ui scale returns', parseFloat(await fs()) === 13, 'font-size=' + await fs());

await setSel('Tools on the', 'right'); await p.waitForTimeout(300);
t('rails swap', await p.evaluate(() => document.body.classList.contains('rails-swapped')));
await p.screenshot({ path: '/tmp/shots/theme-rails-right.png' });
await setSel('Tools on the', 'left'); await p.waitForTimeout(200);

await setSel('Corner rounding', 0); await p.waitForTimeout(200);
t('corner rounding applies', (await css('--r')) === '0px', '--r=' + await css('--r'));
await setSel('Corner rounding', 6); await p.waitForTimeout(150);

// compact tools + hud
const clickCheck = async (label) => p.evaluate(lab => {
  const l = Array.from(document.querySelectorAll('#settings-body label'))
    .find(x => x.textContent.trim().startsWith(lab));
  l.querySelector('input[type=checkbox]').click();
}, label);
await clickCheck('Compact tool rail'); await p.waitForTimeout(250);
t('compact tools class', await p.evaluate(() => document.body.classList.contains('tools-compact')));
await clickCheck('Show the status bar'); await p.waitForTimeout(250);
t('hud hidden class', await p.evaluate(() => document.body.classList.contains('hud-hidden')));
await p.click('.tab[data-tab="map"]'); await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/shots/theme-compact-map.png' });

// rail width
await p.click('.tab[data-tab="settings"]'); await p.waitForTimeout(250);
await p.evaluate(() => {
  const f = Array.from(document.querySelectorAll('#settings-body .field'))
    .find(x => x.querySelector('label') && x.querySelector('label').textContent.trim().startsWith('Tool panel width'));
  const r = f.querySelector('input[type=range]');
  r.value = '400'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(300);
t('rail width applies', (await css('--rail-w')) === '400px', '--rail-w=' + await css('--rail-w'));

// ---- persistence
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
t('theme survives reload', (await css('--bg')) === vell, await css('--bg'));
t('rail width survives reload', (await css('--rail-w')) === '400px');
t('compact survives reload', await p.evaluate(() => document.body.classList.contains('tools-compact')));

// restore defaults for the shipped build
await p.click('.tab[data-tab="settings"]'); await p.waitForTimeout(400);
await p.click('.theme-card:has-text("Graphite")'); await p.waitForTimeout(250);
await clickCheck('Compact tool rail'); await p.waitForTimeout(150);
await clickCheck('Show the status bar'); await p.waitForTimeout(150);
await p.evaluate(() => {
  const f = Array.from(document.querySelectorAll('#settings-body .field'))
    .find(x => x.querySelector('label') && x.querySelector('label').textContent.trim().startsWith('Tool panel width'));
  const r = f.querySelector('input[type=range]');
  r.value = '320'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(300);
await p.click('.tab[data-tab="map"]'); await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/shots/theme-graphite-map.png' });

console.log(ok.map(x => '  ok  ' + x).join('\n'));
if (bad.length) console.log(bad.map(x => 'FAIL  ' + x).join('\n'));
if (errs.length) console.log('errors:\n' + errs.join('\n'));
console.log(`\n${ok.length} passed, ${bad.length} failed, ${errs.length} console errors`);
await b.close();
process.exit(bad.length || errs.length ? 1 : 0);
