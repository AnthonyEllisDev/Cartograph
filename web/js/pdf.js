/* A PDF writer, just big enough for printing a map.
 *
 * Printing at scale needs a file that says how big things are in millimetres,
 * and a PNG cannot: every program that opens one picks its own idea of an
 * inch. PDF is the one format every printer dialog honours at 100%. A whole
 * PDF library would break the first rule of this program, and the part needed
 * here is small: pages of a fixed size, JPEG pictures placed on them (PDF
 * takes a JPEG file as it is), thin lines and a little text in Helvetica, one
 * of the fonts every PDF reader must carry, so nothing is embedded.
 *
 * Units are points, 72 to the inch, with the origin at the bottom left, as in
 * PDF itself. The caller converts; this file knows nothing about maps.
 */

export const PT_PER_MM = 72 / 25.4;

const enc = new TextEncoder();

/** A string as a PDF literal. Helvetica here has no glyphs past ASCII, so
 *  anything else becomes a question mark rather than a wrong letter. */
export function pdfString(text) {
  const ascii = String(text).replace(/[^\x20-\x7e]/g, '?');
  return '(' + ascii.replace(/[\\()]/g, (c) => '\\' + c) + ')';
}

/** Six places is a thousandth of a micron, and it keeps exponents (which PDF
 *  does not read) out of the numbers. */
export const num = (v) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

export class Pdf {
  constructor() {
    this.pages = [];
  }

  /** A new page `w` by `h` points. Returns its drawing commands to add to. */
  page(w, h) {
    const pg = { w, h, ops: [], images: [] };
    this.pages.push(pg);
    const api = {
      /** A JPEG's bytes placed with its bottom-left corner at (x, y). */
      jpeg: (bytes, pxW, pxH, x, y, w2, h2) => {
        const name = 'Im' + pg.images.length;
        pg.images.push({ name, bytes, pxW, pxH });
        pg.ops.push(`q ${num(w2)} 0 0 ${num(h2)} ${num(x)} ${num(y)} cm /${name} Do Q`);
        return api;
      },
      line: (x1, y1, x2, y2, { width = 0.5, grey = 0, dash = null } = {}) => {
        pg.ops.push(`q ${num(width)} w ${num(grey)} G ${dash ? '[' + dash.map(num).join(' ') + '] 0 d ' : ''}`
          + `${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S Q`);
        return api;
      },
      rect: (x, y, w2, h2, { width = 0.5, grey = 0, fill = null } = {}) => {
        if (fill != null) pg.ops.push(`q ${num(fill)} g ${num(x)} ${num(y)} ${num(w2)} ${num(h2)} re f Q`);
        else pg.ops.push(`q ${num(width)} w ${num(grey)} G ${num(x)} ${num(y)} ${num(w2)} ${num(h2)} re S Q`);
        return api;
      },
      text: (x, y, size, text, { bold = false, grey = 0 } = {}) => {
        pg.ops.push(`q ${num(grey)} g BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y)} Td `
          + `${pdfString(text)} Tj ET Q`);
        return api;
      },
    };
    return api;
  }

  /** The finished file. */
  bytes() {
    const chunks = [];
    const offsets = [];
    let length = 0;
    const put = (part) => {
      const b = typeof part === 'string' ? enc.encode(part) : part;
      chunks.push(b);
      length += b.length;
    };
    // Object numbers: 1 catalog, 2 page tree, 3 and 4 the fonts, then for each
    // page its page object, its contents and its pictures.
    let next = 5;
    const plan = this.pages.map((pg) => {
      const page = next++, contents = next++;
      const images = pg.images.map(() => next++);
      return { page, contents, images };
    });
    const obj = (n, body) => {
      offsets[n] = length;
      put(`${n} 0 obj\n`);
      for (const b of [].concat(body)) put(b);
      put('\nendobj\n');
    };

    put('%PDF-1.4\n');
    // Four bytes past 127 on the second line, which is how a PDF tells a
    // transfer program that it is binary and must not be re-encoded.
    put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${plan.map((p) => p.page + ' 0 R').join(' ')}] >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    this.pages.forEach((pg, i) => {
      const p = plan[i];
      const xobj = pg.images.map((im, k) => `/${im.name} ${p.images[k]} 0 R`).join(' ');
      obj(p.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pg.w)} ${num(pg.h)}] `
        + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobj} >> >> `
        + `/Contents ${p.contents} 0 R >>`);
      const stream = enc.encode(pg.ops.join('\n'));
      obj(p.contents, [`<< /Length ${stream.length} >>\nstream\n`, stream, '\nendstream']);
      pg.images.forEach((im, k) => {
        obj(p.images[k], [`<< /Type /XObject /Subtype /Image /Width ${im.pxW} /Height ${im.pxH} `
          + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`,
          im.bytes, '\nendstream']);
      });
    });

    const xref = length;
    // Every entry is exactly twenty bytes, end of line included; readers seek
    // by that arithmetic, so the space before the newline is not optional.
    let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
    for (let n = 1; n < next; n++) table += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    put(table);
    put(`trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
