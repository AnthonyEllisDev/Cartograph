import { launch, base } from './browser.mjs';

const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);

async function drag(points, steps = 5) {
  const first = await M(...points[0]);
  await p.mouse.move(first.x, first.y);
  await p.mouse.down();
  for (const pt of points.slice(1)) {
    const s = await M(...pt);
    await p.mouse.move(s.x, s.y, { steps });
  }
  await p.mouse.up();
  await p.waitForTimeout(90);
}
async function clickAt(mx, my, opts) {
  const s = await M(mx, my);
  await p.mouse.click(s.x, s.y, opts);
  await p.waitForTimeout(60);
}
const tool = async (name) => { await p.click(`.tool:has-text("${name}")`); await p.waitForTimeout(150); };
const pick = async (label) => { await p.click(`#asset-picker .asset[title="${label}"]`); await p.waitForTimeout(120); };
const setOpt = async (label, value) => {
  await p.evaluate(([lab, val]) => {
    const fields = Array.from(document.querySelectorAll('#tool-options .field'));
    const f = fields.find(x => x.querySelector('label span') && x.querySelector('label span').textContent === lab);
    if (!f) return;
    const input = f.querySelector('input,select');
    input.value = val;
    input.dispatchEvent(new Event(input.type === 'range' ? 'input' : 'change', { bubbles: true }));
  }, [label, String(value)]);
  await p.waitForTimeout(60);
};

// ---- landmass
await tool('Landmass');
await setOpt('Size', 300);
await drag([[520,420],[760,330],[1050,360],[1330,430],[1520,620],[1420,880],[1120,1010],[820,960],[600,800],[500,600],[520,420]], 7);
await drag([[1180,520],[1300,560]], 4);
await p.waitForTimeout(400);

// ---- forests
await tool('Terrain');
await pick('Broadleaf Forest');
await setOpt('Size', 190);
await setOpt('Hardness', 0.35);
await setOpt('Opacity', 0.9);
await drag([[640,520],[760,470],[900,500],[1010,470]], 4);
await drag([[700,880],[850,900],[1000,870]], 4);
// ---- highlands
await pick('Highland');
await setOpt('Size', 240);
await drag([[1150,560],[1290,620],[1380,740]], 4);
// ---- sand along the south
await pick('Desert Sand');
await setOpt('Size', 150);
await setOpt('Opacity', 0.8);
await drag([[850,960],[1050,970],[1200,930]], 4);
await p.waitForTimeout(300);

// ---- mountains
await tool('Stamp');
await pick('Mountain Range');
await setOpt('Size', 1.9);
await setOpt('Spacing', 90);
await drag([[1120,600],[1230,650],[1330,730]], 3);
await pick('Snowcapped Peak');
await setOpt('Size', 2.1);
await clickAt(1180, 620);
// ---- forests as stamps
await pick('Pine Stand');
await setOpt('Size', 1.5);
await setOpt('Spacing', 60);
await drag([[640,540],[760,500],[880,530],[1000,500]], 3);
await pick('Woodland');
await drag([[720,890],[860,910],[980,880]], 3);
// ---- settlements
await pick('City');
await setOpt('Size', 1.6);
await clickAt(880, 700);
await pick('Town');
await setOpt('Size', 1.3);
await clickAt(640, 640);
await clickAt(1230, 860);
await pick('Castle');
await clickAt(1360, 560);
await pick('Ship');
await setOpt('Size', 1.4);
await clickAt(1620, 780);
await pick('Compass Rose');
await setOpt('Size', 1.5);
await clickAt(560, 1180);

// ---- river + road
await tool('Path');
await setOpt('Kind', 'river');
await setOpt('Width', 16);
await clickAt(1200, 620); await clickAt(1080, 700); await clickAt(950, 760);
await clickAt(830, 800); await clickAt(700, 860); await clickAt(620, 930);
await p.keyboard.press('Enter');
await p.waitForTimeout(150);
await setOpt('Kind', 'road');
await setOpt('Width', 8);
await clickAt(640, 645); await clickAt(760, 690); await clickAt(880, 705);
await clickAt(1030, 760); await clickAt(1225, 855);
await p.keyboard.press('Enter');
await p.waitForTimeout(200);

// ---- labels
async function label(text, mx, my, style, size) {
  await tool('Label');
  await setOpt('Style', style);
  await setOpt('Size', size);
  await clickAt(mx, my);
  await p.waitForTimeout(200);
  await p.fill('.modal input[type=text]', text);
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(200);
}
await label('THE SUNDERED COAST', 1024, 220, 'title', 76);
await label('Ashenmoor', 800, 470, 'region', 42);
await label('Highmarch', 1290, 700, 'region', 40);
await label('Caldrus', 880, 745, 'settlement', 26);
await label('Fenwick', 640, 685, 'settlement', 24);
await label('Sable Bay', 1600, 900, 'water', 34);

await p.waitForTimeout(600);
await p.evaluate(() => window.__cg.R.fitView());
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_demo.png' });

// export a clean image of just the map
const png = await p.evaluate(async () => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false, paper: true });
  return c.toDataURL('image/png');
});
console.log('errors:', errs.slice(0, 8));
console.log('counts:', await p.evaluate(() => {
  const d = window.__cg.app.doc;
  return Object.fromEntries(d.layers.map(l => [l.kind, (l.ops||[]).length]));
}));
const fs = await import('fs');
fs.writeFileSync('/tmp/cg_map.png', Buffer.from(png.split(',')[1], 'base64'));
await b.close();
