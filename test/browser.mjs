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

/** The server to test against: an argument, then CG_BASE, then the default. */
export function base(fallback = 'http://127.0.0.1:7870/') {
  const url = process.argv[2] || process.env.CG_BASE || fallback;
  return url.endsWith('/') ? url : url + '/';
}
