/* Finding a browser to test in.
 *
 * Every suite used to hard-code an absolute path to a Chromium build, which
 * meant the tests only ran on the one machine they were written on. Playwright
 * can find its own browser; the override exists for the case where it cannot,
 * such as a container that keeps its browsers somewhere else.
 *
 *   npm install playwright && npx playwright install chromium
 *   CG_CHROME=/path/to/chrome node test/verify.mjs      (only if that fails)
 */

import { chromium } from 'playwright';

export async function launch(opts = {}) {
  const override = process.env.CG_CHROME;
  if (override) return chromium.launch({ ...opts, executablePath: override });
  try {
    return await chromium.launch(opts);
  } catch (err) {
    console.error(
      '\nCould not start Chromium. Install it with:\n' +
      '  npx playwright install chromium\n' +
      'or point CG_CHROME at an existing Chrome or Chromium binary.\n');
    throw err;
  }
}

/** Wait until the editor has actually finished booting.
 *
 * Every suite used to sleep for a second and hope. That holds until the box is
 * busy, at which point a suite starts clicking while the last map is still
 * being reopened, and fails somewhere a long way from the cause. A suite that
 * lies about what is broken is worse than no suite. */
export async function ready(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const cg = window.__cg;
    return !!(cg && cg.app && cg.app.doc && cg.app.doc.layers.length
              && document.querySelector('.tool'));
  }, { timeout });
  await page.waitForTimeout(300);
}

/** Start from a map this suite made itself.
 *
 * The editor reopens the last map on launch, which is right for a person and
 * wrong for a test: run two suites back to back and the second one inherits
 * the first one's map, then fails somewhere unrelated because that map has no
 * landmass layer. Every suite that assumes anything about the document should
 * call this first. */
export async function newMap(page, { name = 'Test Map', kind = 'region', size } = {}) {
  await page.click('.tab[data-tab="projects"]');
  await page.waitForTimeout(250);
  await page.click('#btn-new-project');
  await page.waitForTimeout(350);
  await page.fill('.modal input[type=text]', name);
  await page.selectOption('.modal select >> nth=0', kind);
  await page.waitForTimeout(200);
  if (size) await page.selectOption('.modal select >> nth=1', size);
  await page.click('.modal .btn-primary');
  await page.waitForTimeout(900);
  await page.waitForFunction((k) => window.__cg.app.doc && window.__cg.app.doc.kind === k,
                             kind, { timeout: 15000 });
}

/** The server to test against: an argument, then CG_BASE, then the default. */
export function base(fallback = 'http://127.0.0.1:7870/') {
  const url = process.argv[2] || process.env.CG_BASE || fallback;
  return url.endsWith('/') ? url : url + '/';
}
