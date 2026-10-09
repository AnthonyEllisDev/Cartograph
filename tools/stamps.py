"""Map symbols, generated as SVG.

Stamps are vector rather than raster on purpose: a map gets zoomed and exported
at print size, and a mountain drawn as a path stays crisp at any of it. It also
means a stamp is a few hundred bytes of readable XML that anyone can open and
edit, which matters more for an open-source tool than a folder of PNGs would.

Everything is drawn in one ink palette so a map made from mixed symbols still
looks like one cartographer drew it.
"""

import math
import random

INK = "#3a2c1e"          # outline
INK_SOFT = "#5c4732"     # secondary line
FILL_LIGHT = "#f0e2c4"   # lit face
FILL_MID = "#d8c39c"     # body
FILL_DARK = "#a98f68"    # shaded face
STONE = "#b9ae9c"
STONE_DARK = "#8a7f6e"
ROOF = "#8c4a3a"
LEAF = "#4d6b3f"
LEAF_DARK = "#35502c"
LEAF_LIGHT = "#6d8a4e"
TRUNK = "#5a4128"
SNOW = "#f4f6f8"
WATER = "#4a7d99"


def _svg(w, h, body, pad=2):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%d %d %d %d" width="%d" height="%d">'
        '<g fill="none" stroke-linecap="round" stroke-linejoin="round">%s</g></svg>'
    ) % (-pad, -pad, w + pad * 2, h + pad * 2, w + pad * 2, h + pad * 2, body)


def _pts(points):
    return " ".join("%.1f,%.1f" % (x, y) for x, y in points)


def _hatch(points, spacing, angle, colour=INK_SOFT, width=0.7, opacity=0.5):
    """Fill a polygon with parallel pen strokes, clipped by the polygon itself."""
    cid = "h%d" % (abs(hash(tuple(points))) % 100000)
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    diag = math.hypot(x1 - x0, y1 - y0) + spacing
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ca, sa = math.cos(angle), math.sin(angle)
    lines = []
    n = int(diag / spacing) + 1
    for i in range(-n, n + 1):
        off = i * spacing
        ax, ay = cx + ca * -diag - sa * off, cy + sa * -diag + ca * off
        bx, by = cx + ca * diag - sa * off, cy + sa * diag + ca * off
        lines.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f"/>' % (ax, ay, bx, by))
    return ('<clipPath id="%s"><polygon points="%s"/></clipPath>'
            '<g clip-path="url(#%s)" stroke="%s" stroke-width="%.2f" opacity="%.2f">%s</g>'
            % (cid, _pts(points), cid, colour, width, opacity, "".join(lines)))


# ---------------------------------------------------------------- mountains

def mountain(rng, snow=False, peaks=1):
    w, h = 64, 48
    parts = []
    base = h - 2
    span = w / (peaks + 0.6)
    for p in range(peaks):
        cx = span * (p + 0.8)
        ph = h * rng.uniform(0.74, 1.0) if p == 0 else h * rng.uniform(0.52, 0.86)
        top = base - ph
        lw = span * rng.uniform(0.66, 0.84)
        rw = span * rng.uniform(0.66, 0.84)
        # The ridge is a short polyline with one kink in it, not a clean
        # triangle — a drawn mountain never has two straight sides.
        left = [(cx - lw, base),
                (cx - lw * rng.uniform(0.34, 0.5), top + ph * rng.uniform(0.3, 0.44)),
                (cx, top)]
        right = [(cx, top),
                 (cx + rw * rng.uniform(0.3, 0.48), top + ph * rng.uniform(0.28, 0.44)),
                 (cx + rw, base)]
        poly_l = left + [(cx, base)]
        poly_r = right + [(cx, base)]
        parts.append('<polygon points="%s" fill="%s"/>' % (_pts(poly_l), FILL_LIGHT))
        parts.append('<polygon points="%s" fill="%s"/>' % (_pts(poly_r), FILL_DARK))
        parts.append(_hatch(poly_r, 2.6, math.pi / 2.6, INK_SOFT, 0.7, 0.45))
        if snow:
            capy = top + ph * rng.uniform(0.26, 0.36)
            cap = [_along(left[::-1], capy), (cx, top), _along(right, capy)]
            # a ragged snow line, walked back down the two faces
            cap = [cap[0], (cx - 2.5, top + ph * 0.12), (cx, top),
                   (cx + 2.0, top + ph * 0.10), cap[2],
                   (cx + 1.5, capy + 2.5), (cx, capy - 1.0), (cx - 2.0, capy + 3.0)]
            parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="0.7" opacity="0.97"/>'
                         % (_pts(cap), SNOW, "#cdd6de"))
        parts.append('<polyline points="%s" stroke="%s" stroke-width="1.5"/>' % (_pts(left + right[1:]), INK))
    parts.append('<path d="M2,%d Q%d,%d %d,%d" stroke="%s" stroke-width="1.4" opacity="0.8"/>'
                 % (base, w / 2, base + 1.5, w - 2, base, INK))
    return _svg(w, h, "".join(parts))


def _along(pts, y):
    """Point on a polyline at height y, walking from the top down."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if (y0 - y) * (y1 - y) <= 0 and y1 != y0:
            t = (y - y0) / (y1 - y0)
            return (x0 + (x1 - x0) * t, y)
    return pts[-1]


def volcano(rng):
    w, h = 60, 46
    base, top = h - 2, 8
    left = [(4, base), (18, 20), (24, top)]
    right = [(36, top), (42, 20), (w - 4, base)]
    parts = ['<polygon points="%s" fill="%s"/>' % (_pts(left + [(30, base)]), FILL_MID),
             '<polygon points="%s" fill="%s"/>' % (_pts(right + [(30, base)]), FILL_DARK)]
    parts.append(_hatch(right + [(30, base)], 2.6, math.pi / 2.6))
    parts.append('<polygon points="24,%d 30,%d 36,%d" fill="#c9502e"/>' % (top, top + 4, top))
    parts.append('<polyline points="%s" stroke="%s" stroke-width="1.5"/>'
                 % (_pts(left + [(30, top + 3)] + right), INK))
    parts.append('<path d="M27,%d q-4,-6 1,-9 q3,4 6,-1 q3,7 -1,10" fill="#e9e3d6" opacity="0.85"/>' % (top - 1))
    return _svg(w, h, "".join(parts))


def hill(rng, wooded=False):
    w, h = 52, 30
    base = h - 3
    bumps = []
    x = 3.0
    while x < w - 8:
        r = rng.uniform(8, 12)
        bumps.append((x, r))
        x += r * 1.7
    d = ["M%.1f,%.1f" % (bumps[0][0], base)]
    for bx, r in bumps:
        d.append("L%.1f,%.1f" % (bx, base))
        d.append("Q%.1f,%.1f %.1f,%.1f" % (bx + r, base - r * 2.1, bx + r * 2, base))
    d.append("Z")
    body = " ".join(d)
    fill = LEAF_LIGHT if wooded else FILL_MID
    parts = ['<path d="%s" fill="%s" stroke="%s" stroke-width="1.5"/>' % (body, fill, INK)]
    for bx, r in bumps:
        parts.append('<path d="M%.1f,%.1f q%.1f,%.1f %.1f,%.1f" stroke="%s" stroke-width="0.9" opacity="0.55" fill="none"/>'
                     % (bx + r * 1.45, base - 1, -r * 0.25, -r * 0.55, -r * 0.6, -r * 0.62, INK_SOFT))
        if wooded:
            for k in range(3):
                tx = bx + r * (0.55 + k * 0.45) + rng.uniform(-1.5, 1.5)
                ty = base - r * (0.6 + rng.uniform(0, 0.7))
                parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" stroke="%s" stroke-width="0.8"/>'
                             % (tx, ty, rng.uniform(2.4, 3.6), LEAF, INK))
    return _svg(w, h, "".join(parts))


# -------------------------------------------------------------------- trees

def pine(rng):
    w, h = 26, 40
    cx, base = w / 2, h - 3
    parts = ['<rect x="%.1f" y="%.1f" width="3" height="7" fill="%s"/>' % (cx - 1.5, base - 7, TRUNK)]
    tiers = 4
    for i in range(tiers):
        t = i / (tiers - 1)
        y = base - 7 - t * (h - 14)
        half = 10.5 * (1 - t * 0.66) * rng.uniform(0.92, 1.06)
        drop = 7.5 * (1 - t * 0.4)
        parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="1.1"/>'
                     % (_pts([(cx - half, y), (cx, y - drop - 3), (cx + half, y)]),
                        LEAF if i % 2 else LEAF_DARK, INK))
    return _svg(w, h, "".join(parts))


def broadleaf(rng):
    w, h = 30, 34
    cx, base = w / 2, h - 3
    parts = ['<path d="M%.1f,%.1f q-1.5,-6 0.5,-11 M%.1f,%.1f l-4,-4 M%.1f,%.1f l4,-4"'
             ' stroke="%s" stroke-width="2"/>'
             % (cx - 0.5, base, cx, base - 8, cx, base - 6, TRUNK)]
    lobes = []
    for i in range(5):
        a = math.pi * (0.15 + 0.7 * i / 4)
        r = 8.5 * rng.uniform(0.85, 1.1)
        lobes.append((cx - math.cos(a) * 9, base - 13 - math.sin(a) * 7, r))
    for lx, ly, r in lobes:
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (lx, ly, r, LEAF))
    for lx, ly, r in lobes:
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="%s" stroke-width="1.1"/>'
                     % (lx, ly, r, INK))
    parts.append('<circle cx="%.1f" cy="%.1f" r="6" fill="%s" opacity="0.5"/>' % (cx + 3, base - 16, LEAF_LIGHT))
    return _svg(w, h, "".join(parts))


def palm(rng):
    w, h = 30, 38
    cx, base = w / 2 - 2, h - 3
    parts = ['<path d="M%.1f,%.1f q3,-14 7,-22" stroke="%s" stroke-width="2.4"/>' % (cx, base, TRUNK)]
    tipx, tipy = cx + 7, base - 22
    for i in range(6):
        a = math.pi * (0.08 + 0.84 * i / 5) + math.pi
        ex, ey = tipx + math.cos(a) * 12 * rng.uniform(0.8, 1.15), tipy - math.sin(a) * 9 * rng.uniform(0.7, 1.2)
        parts.append('<path d="M%.1f,%.1f Q%.1f,%.1f %.1f,%.1f" stroke="%s" stroke-width="2.6" opacity="0.95"/>'
                     % (tipx, tipy, (tipx + ex) / 2, min(tipy, ey) - 5, ex, ey, LEAF_DARK if i % 2 else LEAF))
    parts.append('<circle cx="%.1f" cy="%.1f" r="2" fill="%s"/>' % (tipx, tipy, TRUNK))
    return _svg(w, h, "".join(parts))


def dead_tree(rng):
    w, h = 26, 34
    cx, base = w / 2, h - 3
    parts = ['<path d="M%.1f,%.1f l0,-16" stroke="%s" stroke-width="2.4"/>' % (cx, base, INK_SOFT)]
    for i in range(5):
        y = base - 8 - i * 4.5
        dx = 8 * rng.uniform(0.5, 1.0) * (1 if i % 2 else -1)
        parts.append('<path d="M%.1f,%.1f l%.1f,%.1f" stroke="%s" stroke-width="1.6"/>'
                     % (cx, y, dx, -5 - rng.uniform(0, 4), INK_SOFT))
    return _svg(w, h, "".join(parts))


def tree_cluster(rng, kind="pine"):
    w, h = 54, 40
    parts = []
    spots = [(12, 34), (27, 37), (42, 33), (20, 26), (35, 27)]
    rng.shuffle(spots)
    for sx, sy in spots:
        s = rng.uniform(0.55, 0.8)
        inner = (pine(rng) if kind == "pine" else broadleaf(rng))
        inner = inner[inner.index("<g"):inner.rindex("</svg>")]
        parts.append('<g transform="translate(%.1f,%.1f) scale(%.2f)">%s</g>'
                     % (sx - 13 * s, sy - 34 * s, s, inner))
    return _svg(w, h, "".join(parts))


# ---------------------------------------------------------------- buildings

def _roofed(x, y, bw, bh, rh, roof=ROOF, wall=FILL_LIGHT):
    return ('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" stroke="%s" stroke-width="1.2"/>'
            '<polygon points="%s" fill="%s" stroke="%s" stroke-width="1.2"/>'
            % (x, y, bw, bh, wall, INK,
               _pts([(x - 1.5, y), (x + bw / 2, y - rh), (x + bw + 1.5, y)]), roof, INK))


def village(rng):
    w, h = 46, 34
    parts = []
    for x, y, bw, bh in [(6, 20, 12, 10), (22, 16, 13, 14), (30, 24, 11, 7)]:
        parts.append(_roofed(x, y, bw, bh, 7 + rng.uniform(0, 2)))
    parts.append('<path d="M2,%d q22,3 42,-1" stroke="%s" stroke-width="1.2" opacity="0.7"/>' % (h - 3, INK))
    return _svg(w, h, "".join(parts))


def town(rng):
    w, h = 58, 40
    parts = []
    for x, y, bw, bh in [(5, 24, 11, 12), (18, 18, 12, 18), (32, 22, 12, 14), (45, 27, 10, 9)]:
        parts.append(_roofed(x, y, bw, bh, 7))
    parts.append('<rect x="26" y="8" width="8" height="12" fill="%s" stroke="%s" stroke-width="1.2"/>' % (FILL_MID, INK))
    parts.append('<polygon points="24,8 30,0 36,8" fill="%s" stroke="%s" stroke-width="1.2"/>' % (ROOF, INK))
    parts.append('<path d="M2,%d q28,4 54,-1" stroke="%s" stroke-width="1.3" opacity="0.75"/>' % (h - 3, INK))
    return _svg(w, h, "".join(parts))


def city(rng):
    w, h = 70, 46
    parts = ['<path d="M4,%d L4,26 Q35,18 66,26 L66,%d Z" fill="%s" stroke="%s" stroke-width="1.4"/>'
             % (h - 4, h - 4, STONE, INK)]
    for i in range(7):
        x = 6 + i * 8.6
        parts.append('<rect x="%.1f" y="%.1f" width="5" height="5" fill="%s"/>' % (x, 22 + i % 2, STONE_DARK))
    for x, y, bw, bh in [(10, 18, 10, 12), (26, 12, 12, 18), (44, 16, 11, 14)]:
        parts.append(_roofed(x, y, bw, bh, 7))
    parts.append('<rect x="32" y="2" width="7" height="12" fill="%s" stroke="%s" stroke-width="1.2"/>' % (FILL_MID, INK))
    parts.append('<polygon points="30,2 35.5,-5 41,2" fill="%s" stroke="%s" stroke-width="1.2"/>' % (ROOF, INK))
    return _svg(w, h, "".join(parts))


def castle(rng):
    w, h = 62, 48
    base = h - 4
    parts = ['<rect x="14" y="18" width="34" height="%d" fill="%s" stroke="%s" stroke-width="1.4"/>'
             % (base - 18, STONE, INK)]
    for tx in (6, 44):
        parts.append('<rect x="%d" y="10" width="12" height="%d" fill="%s" stroke="%s" stroke-width="1.4"/>'
                     % (tx, base - 10, FILL_MID, INK))
        for i in range(3):
            parts.append('<rect x="%d" y="6" width="3" height="5" fill="%s" stroke="%s" stroke-width="1"/>'
                         % (tx + 1 + i * 4.2, FILL_MID, INK))
    for i in range(5):
        parts.append('<rect x="%d" y="14" width="4" height="5" fill="%s" stroke="%s" stroke-width="1"/>'
                     % (16 + i * 6.5, STONE, INK))
    parts.append('<path d="M28,%d l0,-9 a3,3 0 0 1 6,0 l0,9 z" fill="%s" stroke="%s" stroke-width="1.2"/>'
                 % (base, INK_SOFT, INK))
    parts.append('<path d="M50,10 l0,-8 l8,3 l-8,3" fill="#a33" stroke="%s" stroke-width="0.9"/>' % INK)
    parts.append(_hatch([(14, 18), (48, 18), (48, base), (14, base)], 3.4, math.pi / 3, INK_SOFT, 0.6, 0.28))
    return _svg(w, h, "".join(parts))


def tower(rng):
    w, h = 26, 46
    base = h - 3
    parts = ['<rect x="7" y="12" width="12" height="%d" fill="%s" stroke="%s" stroke-width="1.3"/>' % (base - 12, FILL_MID, INK)]
    for i in range(3):
        parts.append('<rect x="%.1f" y="8" width="3" height="5" fill="%s" stroke="%s" stroke-width="1"/>'
                     % (7.5 + i * 4.2, FILL_MID, INK))
    parts.append('<rect x="11" y="24" width="4" height="6" fill="%s"/>' % INK_SOFT)
    parts.append('<path d="M19,8 l0,-6 l7,2.5 l-7,2.5" fill="#a33" stroke="%s" stroke-width="0.8"/>' % INK)
    return _svg(w, h, "".join(parts))


def ruin(rng):
    w, h = 44, 32
    base = h - 3
    parts = []
    for x, top, bw in [(6, 12, 9), (19, 18, 8), (30, 8, 8)]:
        jag = [(x, base), (x, top + rng.uniform(0, 3)), (x + bw * 0.35, top - 2),
               (x + bw * 0.6, top + 3), (x + bw, top + 1), (x + bw, base)]
        parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="1.2"/>' % (_pts(jag), STONE, INK))
        parts.append(_hatch(jag, 3.0, math.pi / 3, INK_SOFT, 0.6, 0.35))
    parts.append('<path d="M2,%d q20,3 40,-1" stroke="%s" stroke-width="1.2" opacity="0.7"/>' % (base, INK))
    return _svg(w, h, "".join(parts))


def windmill(rng):
    w, h = 40, 46
    base = h - 3
    parts = ['<polygon points="%s" fill="%s" stroke="%s" stroke-width="1.3"/>'
             % (_pts([(12, base), (14, 20), (26, 20), (28, base)]), FILL_LIGHT, INK),
             '<polygon points="10,20 20,12 30,20" fill="%s" stroke="%s" stroke-width="1.2"/>' % (ROOF, INK)]
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        parts.append('<path d="M20,15 l%.1f,%.1f" stroke="%s" stroke-width="2"/>'
                     % (math.cos(a) * 13, math.sin(a) * 13, INK))
    parts.append('<circle cx="20" cy="15" r="2" fill="%s"/>' % INK)
    return _svg(w, h, "".join(parts))


def lighthouse(rng):
    w, h = 28, 48
    base = h - 3
    parts = ['<polygon points="%s" fill="%s" stroke="%s" stroke-width="1.3"/>'
             % (_pts([(8, base), (11, 14), (17, 14), (20, base)]), FILL_LIGHT, INK)]
    for i in range(3):
        y = 20 + i * 8
        parts.append('<path d="M%.1f,%.1f L%.1f,%.1f" stroke="#a33" stroke-width="3.2" opacity="0.85"/>'
                     % (9.4 + i * 0.55, y, 18.6 - i * 0.55, y))
    parts.append('<rect x="10" y="8" width="8" height="6" fill="#f2d98a" stroke="%s" stroke-width="1.1"/>' % INK)
    parts.append('<polygon points="8,8 14,3 20,8" fill="%s" stroke="%s" stroke-width="1.1"/>' % (INK_SOFT, INK))
    return _svg(w, h, "".join(parts))


def cave(rng):
    w, h = 36, 28
    base = h - 3
    parts = ['<path d="M3,%d Q4,10 18,7 Q32,10 33,%d Z" fill="%s" stroke="%s" stroke-width="1.3"/>'
             % (base, base, STONE, INK),
             '<path d="M12,%d Q13,17 18,15 Q23,17 24,%d Z" fill="%s"/>' % (base, base, "#241c14")]
    parts.append(_hatch([(3, base), (18, 7), (33, base)], 3.2, math.pi / 3, INK_SOFT, 0.6, 0.3))
    return _svg(w, h, "".join(parts))


def mine(rng):
    w, h = 34, 28
    base = h - 3
    parts = ['<path d="M4,%d L10,10 L24,10 L30,%d Z" fill="%s" stroke="%s" stroke-width="1.3"/>' % (base, base, FILL_MID, INK),
             '<rect x="13" y="14" width="8" height="%d" fill="#241c14"/>' % (base - 14),
             '<path d="M8,10 L26,10" stroke="%s" stroke-width="2"/>' % INK_SOFT]
    return _svg(w, h, "".join(parts))


def standing_stones(rng):
    w, h = 40, 30
    base = h - 4
    parts = ['<ellipse cx="20" cy="%d" rx="17" ry="4" fill="none" stroke="%s" stroke-width="1" opacity="0.6"/>' % (base, INK)]
    for i in range(5):
        a = math.pi * (0.12 + 0.76 * i / 4)
        x = 20 - math.cos(a) * 15
        y = base - math.sin(a) * 3
        hh = rng.uniform(9, 15)
        parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="1.1"/>'
                     % (_pts([(x - 2.5, y), (x - 2, y - hh), (x + 2, y - hh + 1), (x + 2.5, y)]), STONE, INK))
    return _svg(w, h, "".join(parts))


def bridge(rng):
    w, h = 46, 24
    parts = ['<path d="M3,18 Q23,2 43,18" stroke="%s" stroke-width="3" fill="none"/>' % FILL_MID,
             '<path d="M3,18 Q23,2 43,18" stroke="%s" stroke-width="1.2" fill="none"/>' % INK]
    for i in range(5):
        t = 0.15 + i * 0.175
        x = 3 + 40 * t
        y = 18 - 16 * (1 - (2 * t - 1) ** 2)
        parts.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1"/>' % (x, y, x, y + 5, INK_SOFT))
    return _svg(w, h, "".join(parts))


def ship(rng):
    w, h = 46, 40
    parts = [
        # hull: a shallow crescent, wider at the deck than the keel
        '<path d="M3,26 Q23,24 43,26 L37,36 Q23,40 9,36 Z" fill="%s" stroke="%s" stroke-width="1.4"/>' % (TRUNK, INK),
        '<path d="M6,29 Q23,31 40,29" stroke="%s" stroke-width="1" opacity="0.6" fill="none"/>' % FILL_MID,
        '<line x1="23" y1="26" x2="23" y2="3" stroke="%s" stroke-width="1.8"/>' % INK,
        '<line x1="12" y1="9" x2="34" y2="9" stroke="%s" stroke-width="1.4"/>' % INK,
        # a square mainsail bellied out on the yard, plus a foresail
        '<path d="M12,9 Q23,13 34,9 L32,22 Q23,26 14,22 Z" fill="%s" stroke="%s" stroke-width="1.3"/>' % (FILL_LIGHT, INK),
        '<path d="M15,13 Q23,16 31,13 M15,17 Q23,20 31,17" stroke="%s" stroke-width="0.8" opacity="0.5" fill="none"/>' % INK_SOFT,
        '<path d="M23,6 L23,22 L11,24 Z" fill="%s" stroke="%s" stroke-width="1.2" opacity="0.95"/>' % (FILL_MID, INK),
        '<path d="M23,3 l0,-3 l7,2 l-7,2" fill="#a33" stroke="%s" stroke-width="0.8"/>' % INK,
        '<path d="M1,33 q11,4 22,0 q11,-4 22,0" stroke="%s" stroke-width="1.2" opacity="0.65" fill="none"/>' % WATER,
    ]
    return _svg(w, h, "".join(parts))


def sea_serpent(rng):
    w, h = 70, 36
    coil = "M4,26 q9,-18 18,0 q9,18 18,0 q7,-14 14,-4"
    parts = [
        '<path d="%s" stroke="%s" stroke-width="5" fill="none"/>' % (coil, LEAF_DARK),
        '<path d="%s" stroke="%s" stroke-width="1.2" fill="none"/>' % (coil, INK),
        # head, jaw and eye
        '<path d="M54,22 q6,-8 13,-9 q-2,6 -5,8 q5,1 5,5 q-7,1 -13,-4 z" fill="%s" stroke="%s" stroke-width="1.2"/>'
        % (LEAF_DARK, INK),
        '<circle cx="62" cy="17" r="1.2" fill="%s"/>' % INK,
        '<path d="M8,26 q4,-6 8,-6 M26,26 q4,-6 8,-6" stroke="%s" stroke-width="1" opacity="0.7" fill="none"/>' % LEAF,
        '<path d="M2,31 q17,4 34,0 q17,-4 32,0" stroke="%s" stroke-width="1.2" opacity="0.6" fill="none"/>' % WATER,
    ]
    return _svg(w, h, "".join(parts))


def compass_rose(rng):
    w = h = 76
    c = w / 2
    parts = ['<circle cx="%g" cy="%g" r="30" fill="none" stroke="%s" stroke-width="1.2" opacity="0.8"/>' % (c, c, INK),
             '<circle cx="%g" cy="%g" r="25" fill="none" stroke="%s" stroke-width="0.7" opacity="0.6"/>' % (c, c, INK)]
    for i in range(8):
        a = i * math.pi / 4
        long_arm = (i % 2 == 0)
        r = 30 if long_arm else 19
        sw = 5.5 if long_arm else 3.5
        tipx, tipy = c + math.sin(a) * r, c - math.cos(a) * r
        lx, ly = c + math.sin(a + math.pi / 2) * sw, c - math.cos(a + math.pi / 2) * sw
        rx, ry = c + math.sin(a - math.pi / 2) * sw, c - math.cos(a - math.pi / 2) * sw
        parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="0.9"/>'
                     % (_pts([(tipx, tipy), (lx, ly), (c, c)]), FILL_LIGHT, INK))
        parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="0.9"/>'
                     % (_pts([(tipx, tipy), (rx, ry), (c, c)]), INK_SOFT, INK))
    parts.append('<circle cx="%g" cy="%g" r="3" fill="%s" stroke="%s" stroke-width="0.9"/>' % (c, c, FILL_LIGHT, INK))
    parts.append('<text x="%g" y="9" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="%s">N</text>' % (c, INK))
    return _svg(w, h, "".join(parts))


def swamp_tuft(rng):
    w, h = 34, 22
    parts = ['<path d="M3,%d q14,3 28,0" stroke="%s" stroke-width="1.2" opacity="0.7"/>' % (h - 4, WATER)]
    for i in range(7):
        x = 5 + i * 4 + rng.uniform(-1, 1)
        hh = rng.uniform(7, 14)
        parts.append('<path d="M%.1f,%.1f q%.1f,%.1f %.1f,%.1f" stroke="%s" stroke-width="1.4"/>'
                     % (x, h - 5, rng.uniform(-2, 2), -hh * 0.6, rng.uniform(-4, 4), -hh, LEAF_DARK))
    return _svg(w, h, "".join(parts))


def cactus(rng):
    w, h = 24, 34
    parts = ['<path d="M12,%d L12,10" stroke="%s" stroke-width="5.5"/>' % (h - 3, LEAF),
             '<path d="M12,20 q-6,0 -6,-6 M6,14 l0,4" stroke="%s" stroke-width="4"/>' % LEAF,
             '<path d="M12,24 q6,0 6,-7 M18,17 l0,5" stroke="%s" stroke-width="4"/>' % LEAF,
             '<path d="M12,%d L12,10" stroke="%s" stroke-width="1" opacity="0.5"/>' % (h - 3, INK)]
    return _svg(w, h, "".join(parts))


# ------------------------------------------------- furnishings, from above
#
# Everything above is drawn side-on, the way an atlas draws a mountain. A
# battle map is looked down on, so these are plans: drawn at five feet to
# seventy pixels, the scale of a new battle map, so a table is two squares long
# at a scale of 1. The light still comes from the north-west.

WOOD = "#9a6b42"
WOOD_LIGHT = "#b98a5a"
WOOD_DARK = "#6e4a2c"
IRON = "#4a4038"
BRASS = "#c9a24a"
CLOTHS = ["#8c4a3a", "#4a5f7d", "#5d7046", "#7a5a86", "#a07a3a"]


def _wood(rng):
    """One of three timbers, so a room of furniture is not one plank."""
    return rng.choice([(WOOD, WOOD_LIGHT, WOOD_DARK),
                       ("#8a5c38", "#a8784c", "#5e3e24"),
                       ("#a27c52", "#c29a6c", "#76573a")])


def _boards(x, y, w, h, n, along_x, colour, opacity=0.55):
    """Lines between n boards filling a rectangle."""
    out = []
    for k in range(1, n):
        if along_x:
            yy = y + h * k / n
            out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f"/>' % (x, yy, x + w, yy))
        else:
            xx = x + w * k / n
            out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f"/>' % (xx, y, xx, y + h))
    return '<g stroke="%s" stroke-width="0.9" opacity="%.2f">%s</g>' % (colour, opacity, "".join(out))


def barrel(rng):
    w = h = 48
    c, r = 24, 21
    body, light, dark = _wood(rng)
    cid = "b%d" % rng.randrange(100000)
    staves = []
    for k in range(1, 6):
        xx = c - r + 2 * r * k / 6 + rng.uniform(-0.6, 0.6)
        staves.append('<line x1="%.1f" y1="0" x2="%.1f" y2="%d"/>' % (xx, xx, h))
    parts = [
        '<circle cx="%d" cy="%d" r="%d" fill="%s"/>' % (c, c, r, body),
        '<clipPath id="%s"><circle cx="%d" cy="%d" r="%d"/></clipPath>' % (cid, c, c, r - 4),
        '<g clip-path="url(#%s)" stroke="%s" stroke-width="0.9" opacity="0.6">%s</g>' % (cid, dark, "".join(staves)),
        '<path d="M%.1f,%.1f A%d,%d 0 0 1 %.1f,%.1f" stroke="%s" stroke-width="2" opacity="0.5"/>'
        % (c - r * 0.8, c - r * 0.2, r - 3, r - 3, c + r * 0.2, c - r * 0.8, light),
        '<circle cx="%d" cy="%d" r="%d" stroke="%s" stroke-width="2.6"/>' % (c, c, r - 1.5, IRON),
        '<circle cx="%d" cy="%d" r="%d" stroke="%s" stroke-width="1.4" opacity="0.8"/>' % (c, c, r - 5, IRON),
        '<circle cx="%.1f" cy="%.1f" r="2.2" fill="%s" stroke="%s" stroke-width="0.8"/>'
        % (c + rng.uniform(-6, 6), c + rng.uniform(-6, 6), dark, INK),
        '<circle cx="%d" cy="%d" r="%d" stroke="%s" stroke-width="1.4"/>' % (c, c, r, INK),
    ]
    return _svg(w, h, "".join(parts))


def crate(rng):
    w = h = 52
    body, light, dark = _wood(rng)
    m = 5
    parts = [
        '<rect x="0" y="0" width="%d" height="%d" fill="%s"/>' % (w, h, body),
        _boards(m, m, w - 2 * m, h - 2 * m, rng.choice((3, 4)), rng.random() < 0.5, dark),
        # The frame round the lid, and a brace corner to corner.
        '<rect x="%.1f" y="%.1f" width="%d" height="%d" stroke="%s" stroke-width="%d" opacity="0.9"/>'
        % (m / 2, m / 2, w - m, h - m, light, m),
        '<path d="M%d,%d L%d,%d" stroke="%s" stroke-width="5" opacity="0.95"/>' % (m, m, w - m, h - m, light)
        if rng.random() < 0.5 else
        '<path d="M%d,%d L%d,%d" stroke="%s" stroke-width="5" opacity="0.95"/>' % (w - m, m, m, h - m, light),
        '<rect x="%d" y="%d" width="%d" height="%d" stroke="%s" stroke-width="0.8" opacity="0.7"/>'
        % (m, m, w - 2 * m, h - 2 * m, dark),
    ]
    for x, y in ((2.5, 2.5), (w - 2.5, 2.5), (2.5, h - 2.5), (w - 2.5, h - 2.5)):
        parts.append('<circle cx="%.1f" cy="%.1f" r="1" fill="%s"/>' % (x, y, IRON))
    parts.append('<rect x="0" y="0" width="%d" height="%d" stroke="%s" stroke-width="1.4"/>' % (w, h, INK))
    return _svg(w, h, "".join(parts))


def table(rng):
    w, h = 132, 66
    body, light, dark = _wood(rng)
    parts = [
        '<rect x="0" y="0" width="%d" height="%d" rx="3" fill="%s"/>' % (w, h, body),
        _boards(0, 0, w, h, 4, True, dark),
        '<rect x="2.5" y="2.5" width="%d" height="%d" rx="2" stroke="%s" stroke-width="1.6" opacity="0.6"/>'
        % (w - 5, h - 5, light),
    ]
    # Whatever was left on it: a plate, a tankard, a candle, or nothing.
    for _ in range(rng.randint(0, 3)):
        x, y = rng.uniform(16, w - 16), rng.uniform(14, h - 14)
        what = rng.random()
        if what < 0.4:
            parts.append('<circle cx="%.1f" cy="%.1f" r="7" fill="%s" stroke="%s" stroke-width="0.9"/>'
                         '<circle cx="%.1f" cy="%.1f" r="4.5" stroke="%s" stroke-width="0.6" opacity="0.6"/>'
                         % (x, y, FILL_LIGHT, INK, x, y, INK_SOFT))
        elif what < 0.75:
            parts.append('<circle cx="%.1f" cy="%.1f" r="4" fill="%s" stroke="%s" stroke-width="0.9"/>'
                         '<path d="M%.1f,%.1f q4,0 4,3" stroke="%s" stroke-width="1.2"/>'
                         % (x, y, STONE, INK, x + 3.5, y - 1, INK))
        else:
            parts.append('<circle cx="%.1f" cy="%.1f" r="3" fill="%s" stroke="%s" stroke-width="0.8"/>'
                         '<circle cx="%.1f" cy="%.1f" r="1.2" fill="#f2d98a"/>'
                         % (x, y, FILL_LIGHT, INK, x, y))
    parts.append('<rect x="0" y="0" width="%d" height="%d" rx="3" stroke="%s" stroke-width="1.5"/>' % (w, h, INK))
    return _svg(w, h, "".join(parts))


def bed(rng):
    w, h = 68, 132
    body, light, dark = _wood(rng)
    cloth = rng.choice(CLOTHS)
    fold = rng.uniform(46, 58)
    parts = [
        '<rect x="0" y="0" width="%d" height="%d" rx="2" fill="%s" stroke="%s" stroke-width="1.4"/>' % (w, h, dark, INK),
        '<rect x="0" y="0" width="%d" height="7" fill="%s" stroke="%s" stroke-width="1.2"/>' % (w, body, INK),
        '<rect x="4" y="9" width="%d" height="%d" rx="3" fill="%s" stroke="%s" stroke-width="1"/>'
        % (w - 8, h - 13, FILL_LIGHT, INK),
        '<rect x="10" y="13" width="%d" height="18" rx="7" fill="#f6efe0" stroke="%s" stroke-width="1"/>' % (w - 20, INK),
        # The blanket, turned back at the top.
        '<path d="M3,%.1f L%d,%.1f L%d,%d Q%d,%d %d,%d Z" fill="%s" stroke="%s" stroke-width="1.1"/>'
        % (fold, w - 3, fold, w - 3, h - 3, w / 2, h + 1, 3, h - 3, cloth, INK),
        '<rect x="3" y="%.1f" width="%d" height="6" fill="%s" stroke="%s" stroke-width="0.9"/>'
        % (fold - 6, w - 6, FILL_LIGHT, INK),
        '<path d="M%d,%.1f q4,%.1f 0,%.1f M%d,%.1f q-4,%.1f 0,%.1f" stroke="%s" stroke-width="0.9" opacity="0.45"/>'
        % (w / 3, fold + 8, 30, 60, 2 * w / 3, fold + 10, 26, 56, INK),
    ]
    return _svg(w, h, "".join(parts))


def chest(rng):
    w, h = 60, 40
    body, light, dark = _wood(rng)
    parts = [
        '<rect x="0" y="0" width="%d" height="%d" rx="2" fill="%s"/>' % (w, h, body),
        _boards(0, 0, w, h, 3, True, dark),
        '<path d="M0,%.1f L%d,%.1f" stroke="%s" stroke-width="1.4" opacity="0.7"/>' % (h * 0.32, w, h * 0.32, light),
    ]
    for bx in (9, w - 13):
        parts.append('<rect x="%d" y="0" width="4" height="%d" fill="%s"/>' % (bx, h, IRON))
        for by in (5, h / 2, h - 5):
            parts.append('<circle cx="%d" cy="%.1f" r="0.9" fill="%s"/>' % (bx + 2, by, BRASS))
    parts.append('<rect x="%.1f" y="%d" width="10" height="9" rx="1.5" fill="%s" stroke="%s" stroke-width="0.9"/>'
                 % (w / 2 - 5, h - 9, BRASS, INK))
    parts.append('<circle cx="%.1f" cy="%d" r="1.3" fill="%s"/>' % (w / 2, h - 5, INK))
    parts.append('<rect x="0" y="0" width="%d" height="%d" rx="2" stroke="%s" stroke-width="1.4"/>' % (w, h, INK))
    return _svg(w, h, "".join(parts))


def bookshelf(rng):
    w, h = 136, 30
    body, light, dark = _wood(rng)
    parts = ['<rect x="0" y="0" width="%d" height="%d" fill="%s" stroke="%s" stroke-width="1.4"/>' % (w, h, body, INK),
             '<rect x="3" y="3" width="%d" height="%d" fill="%s"/>' % (w - 6, h - 9, dark)]
    # The tops of the books, front edge down: varied widths, a few gaps, one
    # lying flat.
    x = 4.0
    while x < w - 6:
        bw = rng.uniform(3, 7)
        if rng.random() < 0.08:
            x += rng.uniform(4, 9)
            continue
        depth = rng.uniform(h - 16, h - 11)
        colour = rng.choice(CLOTHS + [FILL_MID, FILL_DARK])
        bw = min(bw, w - 4 - x)
        parts.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" stroke="%s" stroke-width="0.5"/>'
                     % (x, h - 6 - depth, bw, depth, colour, INK))
        x += bw + 0.3
    parts.append('<line x1="%.1f" y1="3" x2="%.1f" y2="%d" stroke="%s" stroke-width="2"/>' % (w / 2, w / 2, h - 6, body))
    parts.append('<rect x="0" y="%d" width="%d" height="6" fill="%s" stroke="%s" stroke-width="1.1"/>' % (h - 6, w, light, INK))
    return _svg(w, h, "".join(parts))


def rug(rng):
    w, h = 176, 116
    field, border = rng.sample(CLOTHS, 2)
    fringe = []
    for x in range(10, w - 9, 4):
        fringe.append('<line x1="%d" y1="0" x2="%d" y2="6"/>' % (x, x))
        fringe.append('<line x1="%d" y1="%d" x2="%d" y2="%d"/>' % (x, h - 6, x, h))
    parts = ['<g stroke="%s" stroke-width="1">%s</g>' % (FILL_MID, "".join(fringe))]
    parts.append('<rect x="6" y="6" width="%d" height="%d" fill="%s" stroke="%s" stroke-width="1.3"/>'
                 % (w - 12, h - 12, border, INK))
    parts.append('<rect x="16" y="16" width="%d" height="%d" fill="%s" stroke="%s" stroke-width="1"/>'
                 % (w - 32, h - 32, field, FILL_LIGHT))
    parts.append('<rect x="11" y="11" width="%d" height="%d" stroke="%s" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>'
                 % (w - 22, h - 22, FILL_LIGHT))
    cx, cy = w / 2, h / 2
    rx, ry = rng.uniform(30, 40), rng.uniform(22, 28)
    parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="1"/>'
                 % (_pts([(cx - rx, cy), (cx, cy - ry), (cx + rx, cy), (cx, cy + ry)]), border, FILL_LIGHT))
    parts.append('<polygon points="%s" fill="%s"/>'
                 % (_pts([(cx - rx / 2.5, cy), (cx, cy - ry / 2.5), (cx + rx / 2.5, cy), (cx, cy + ry / 2.5)]), FILL_LIGHT))
    for qx, qy in ((24, 24), (w - 24, 24), (24, h - 24), (w - 24, h - 24)):
        parts.append('<circle cx="%d" cy="%d" r="3.5" fill="%s" stroke="%s" stroke-width="0.8"/>' % (qx, qy, border, FILL_LIGHT))
    return _svg(w, h, "".join(parts))


def well(rng):
    w = h = 100
    c = 50
    outer, inner = 46, 31
    parts = ['<circle cx="%d" cy="%d" r="%d" fill="%s"/>' % (c, c, outer, STONE_DARK)]
    # The coping, stone by stone: segments of the ring with a joint between.
    n = rng.randint(11, 14)
    start = rng.uniform(0, math.pi * 2)
    for k in range(n):
        a0 = start + k * 2 * math.pi / n + 0.035
        a1 = start + (k + 1) * 2 * math.pi / n - 0.035
        ro, ri = outer - 1.5, inner + 1.5
        pts = (c + math.cos(a0) * ro, c + math.sin(a0) * ro, ro, ro,
               c + math.cos(a1) * ro, c + math.sin(a1) * ro,
               c + math.cos(a1) * ri, c + math.sin(a1) * ri, ri, ri,
               c + math.cos(a0) * ri, c + math.sin(a0) * ri)
        shade = STONE if rng.random() < 0.7 else "#c8beac"
        parts.append('<path d="M%.1f,%.1f A%.1f,%.1f 0 0 1 %.1f,%.1f L%.1f,%.1f A%.1f,%.1f 0 0 0 %.1f,%.1f Z" '
                     'fill="%s" stroke="%s" stroke-width="0.8"/>' % (pts + (shade, INK_SOFT)))
    parts.append('<circle cx="%d" cy="%d" r="%d" fill="#2b4252" stroke="%s" stroke-width="1.2"/>' % (c, c, inner, INK))
    parts.append('<circle cx="%d" cy="%d" r="%d" fill="%s" opacity="0.8"/>' % (c + 3, c + 3, inner - 6, WATER))
    parts.append('<path d="M%d,%d q8,-4 16,0 M%d,%d q6,-3 12,0" stroke="#a9c8d8" stroke-width="1" opacity="0.7"/>'
                 % (c - 12, c + 6, c - 2, c + 14))
    # The winch: a beam on two posts, with the bucket hanging under it.
    ang = rng.choice((0, 90))
    parts.append('<g transform="rotate(%d %d %d)">'
                 '<rect x="2" y="%d" width="%d" height="8" fill="%s" stroke="%s" stroke-width="1.2"/>'
                 '<rect x="4" y="%d" width="8" height="12" fill="%s" stroke="%s" stroke-width="1"/>'
                 '<rect x="%d" y="%d" width="8" height="12" fill="%s" stroke="%s" stroke-width="1"/>'
                 '<circle cx="%d" cy="%d" r="6" fill="%s" stroke="%s" stroke-width="1"/>'
                 '<circle cx="%d" cy="%d" r="3.5" stroke="%s" stroke-width="0.8"/></g>'
                 % (ang, c, c, c - 4, w - 4, WOOD, INK, c - 6, WOOD_DARK, INK, w - 12, c - 6, WOOD_DARK, INK,
                    c + 14, c + 2, WOOD_LIGHT, INK, c + 14, c + 2, IRON))
    parts.append('<circle cx="%d" cy="%d" r="%d" stroke="%s" stroke-width="1.4"/>' % (c, c, outer, INK))
    return _svg(w, h, "".join(parts))


# ---------------------------------------------------------------- underground
#
# Plans again, at the furnishings' five feet to seventy pixels: what a cave or
# a crypt has in it that a house does not. Added 2026-10-07 (art version 3).

EMBER = "#e8862c"
FLAME = "#f6c74a"
FLAME_HOT = "#fff1b8"
CAVE = "#6f665b"
CAVE_LIGHT = "#968b7c"
CAVE_DARK = "#4c453d"
FUNGUS = ["#b9673f", "#c9a25a", "#8f6aa0", "#d6d0b8"]


def _rock(rng, cx, cy, r, sides=None, fill=STONE, stroke=INK, width=1.0):
    """An irregular stone outline: a polygon with its corners pulled about."""
    sides = sides or rng.randint(5, 8)
    start = rng.uniform(0, math.pi * 2)
    pts = []
    for k in range(sides):
        a = start + k * 2 * math.pi / sides + rng.uniform(-0.25, 0.25)
        rr = r * rng.uniform(0.72, 1.0)
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return '<polygon points="%s" fill="%s" stroke="%s" stroke-width="%.1f"/>' % (_pts(pts), fill, stroke, width)


def pillar(rng):
    w = h = 70
    c = 35
    square = rng.random() < 0.34
    parts = []
    # The plinth, a little wider than the shaft, square in two of three.
    parts.append('<rect x="3" y="3" width="64" height="64" rx="%d" fill="%s" stroke="%s" stroke-width="1.3"/>'
                 % (3 if square else 32, CAVE_DARK, INK))
    if square:
        parts.append('<rect x="10" y="10" width="50" height="50" fill="%s" stroke="%s" stroke-width="1.2"/>' % (STONE, INK))
        parts.append('<path d="M10,60 L10,10 L60,10" stroke="#d6ccb8" stroke-width="2.4" opacity="0.8"/>')
        parts.append('<path d="M60,10 L60,60 L10,60" stroke="%s" stroke-width="2.4" opacity="0.7"/>' % STONE_DARK)
    else:
        r = rng.uniform(23, 26)
        parts.append('<circle cx="%d" cy="%d" r="%.1f" fill="%s" stroke="%s" stroke-width="1.2"/>' % (c, c, r, "#c8beac", INK))
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" opacity="0.45"/>' % (c + 4, c + 4, r - 6, STONE_DARK))
        # Flutes, seen end on: notches round the rim.
        flutes = rng.choice((0, 12, 16))
        for k in range(flutes):
            a = k * 2 * math.pi / flutes
            parts.append('<circle cx="%.1f" cy="%.1f" r="1.6" fill="%s"/>'
                         % (c + math.cos(a) * (r - 2.5), c + math.sin(a) * (r - 2.5), STONE_DARK))
        parts.append('<path d="M%.1f,%.1f A%.1f,%.1f 0 0 1 %.1f,%.1f" stroke="#d6ccb8" stroke-width="2.4" opacity="0.8"/>'
                     % (c - r * 0.85, c + r * 0.2, r - 4, r - 4, c + r * 0.2, c - r * 0.85))
    # A crack, now and then.
    if rng.random() < 0.5:
        x, y = c + rng.uniform(-8, 8), c + rng.uniform(-8, 8)
        parts.append('<path d="M%.1f,%.1f l%.1f,%.1f l%.1f,%.1f" stroke="%s" stroke-width="0.8" opacity="0.7"/>'
                     % (x, y, rng.uniform(-6, 6), rng.uniform(4, 9), rng.uniform(-6, 6), rng.uniform(3, 7), INK_SOFT))
    return _svg(w, h, "".join(parts))


def stalagmites(rng):
    w = h = 100
    parts = []
    spikes = []
    for _ in range(rng.randint(3, 6)):
        for _try in range(20):
            r = rng.uniform(8, 19)
            x, y = rng.uniform(r + 2, w - r - 2), rng.uniform(r + 2, h - r - 2)
            if all(math.hypot(x - sx, y - sy) > (r + sr) * 0.7 for sx, sy, sr in spikes):
                spikes.append((x, y, r))
                break
    # Seen from above, a stalagmite is rings closing on its tip, and the tip
    # sits towards the light.
    for x, y, r in sorted(spikes, key=lambda s: s[1]):
        parts.append('<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="#000" opacity="0.22"/>'
                     % (x + r * 0.25, y + r * 0.3, r, r * 0.9))
        parts.append(_rock(rng, x, y, r, rng.randint(7, 10), CAVE, INK, 1.1))
        tx, ty = x - r * 0.22, y - r * 0.25
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" stroke="%s" stroke-width="0.6" opacity="0.9"/>'
                     % ((x + tx) / 2, (y + ty) / 2, r * 0.6, CAVE_LIGHT, INK_SOFT))
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#c3b8a6"/>' % (tx, ty, max(1.5, r * 0.22)))
    return _svg(w, h, "".join(parts))


def rubble(rng):
    w, h = 112, 88
    parts = []
    # A heap: big stones near the middle, chips thrown out round it.
    for _ in range(rng.randint(18, 26)):
        a = rng.uniform(0, math.pi * 2)
        d = abs(rng.gauss(0, 0.5))
        x = w / 2 + math.cos(a) * d * (w / 2 - 8)
        y = h / 2 + math.sin(a) * d * (h / 2 - 8)
        r = max(3.0, 17 * (1.0 - 0.7 * min(1.0, d)) * rng.uniform(0.55, 1.0))
        x = min(w - r - 1, max(r + 1, x))
        y = min(h - r - 1, max(r + 1, y))
        fill = rng.choice((CAVE, CAVE_LIGHT, STONE_DARK, STONE))
        parts.append((d, _rock(rng, x, y, r, None, fill, INK, 0.9)))
    parts.sort(key=lambda t: -t[0])
    return _svg(w, h, "".join(p for _, p in parts))


def campfire(rng):
    w = h = 70
    c = 35
    parts = ['<circle cx="%d" cy="%d" r="22" fill="#3b3029" opacity="0.85"/>' % (c, c)]
    n = rng.randint(8, 11)
    for k in range(n):
        a = k * 2 * math.pi / n + rng.uniform(-0.1, 0.1)
        parts.append(_rock(rng, c + math.cos(a) * 26, c + math.sin(a) * 26, rng.uniform(5, 7),
                           None, rng.choice((STONE, STONE_DARK)), INK, 0.9))
    # Logs crossed over the coals.
    turn = rng.uniform(0, 180)
    for k in range(rng.choice((2, 3))):
        ang = turn + k * 180 / 3 * (1 if k % 2 else -1)
        parts.append('<g transform="rotate(%.1f %d %d)"><rect x="%d" y="%d" width="32" height="7" rx="3" '
                     'fill="%s" stroke="%s" stroke-width="0.9"/><circle cx="%d" cy="%d" r="2.6" fill="#3a2c1e"/></g>'
                     % (ang, c, c, c - 16, c - 3.5, WOOD_DARK, INK, c + 13, c))
    for k in range(rng.randint(4, 6)):
        x, y = c + rng.uniform(-7, 7), c + rng.uniform(-7, 7)
        r = rng.uniform(4, 8)
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" opacity="0.85"/>' % (x, y, r, EMBER))
    parts.append('<circle cx="%d" cy="%d" r="6" fill="%s" opacity="0.95"/>' % (c, c, FLAME))
    parts.append('<circle cx="%.1f" cy="%.1f" r="2.6" fill="%s"/>' % (c - 1, c - 1, FLAME_HOT))
    return _svg(w, h, "".join(parts))


def altar(rng):
    w, h = 124, 66
    cloth = rng.choice(CLOTHS)
    parts = [
        '<rect x="0" y="0" width="%d" height="%d" rx="2" fill="%s" stroke="%s" stroke-width="1.4"/>' % (w, h, STONE_DARK, INK),
        '<rect x="5" y="5" width="%d" height="%d" fill="%s" stroke="%s" stroke-width="1"/>' % (w - 10, h - 10, STONE, INK_SOFT),
        '<path d="M5,%d L5,5 L%d,5" stroke="#d6ccb8" stroke-width="2" opacity="0.8"/>' % (h - 5, w - 5),
    ]
    if rng.random() < 0.67:
        # A runner laid across the top and hanging over the front.
        parts.append('<rect x="%.1f" y="0" width="30" height="%d" fill="%s" stroke="%s" stroke-width="1"/>'
                     % (w / 2 - 15, h + 4, cloth, INK))
        parts.append('<path d="M%.1f,%d l7.5,-4 l7.5,4 l7.5,-4 l7.5,4" stroke="%s" stroke-width="1" fill="%s"/>'
                     % (w / 2 - 15, h + 4, INK, cloth))
    else:
        parts.append('<circle cx="%.1f" cy="%.1f" r="10" fill="#7a2a22" stroke="%s" stroke-width="1"/>' % (w / 2, h / 2, INK))
        parts.append('<path d="M%.1f,%.1f l-6,9 M%.1f,%.1f l7,7" stroke="#7a2a22" stroke-width="2.4"/>'
                     % (w / 2 - 6, h / 2 + 6, w / 2 + 6, h / 2 + 6))
    for x in (16, w - 16):
        parts.append('<circle cx="%d" cy="%.1f" r="5.5" fill="%s" stroke="%s" stroke-width="0.9"/>'
                     '<circle cx="%d" cy="%.1f" r="2.4" fill="%s"/><circle cx="%d" cy="%.1f" r="1" fill="%s"/>'
                     % (x, h / 2, FILL_LIGHT, INK, x, h / 2, FLAME, x, h / 2, FLAME_HOT))
    return _svg(w, h, "".join(parts))


def stairs(rng):
    w, h = 70, 140
    steps = rng.choice((7, 8, 9))
    parts = ['<rect x="0" y="0" width="%d" height="%d" fill="%s" stroke="%s" stroke-width="1.4"/>' % (w, h, STONE_DARK, INK)]
    # Going down, each tread a little darker than the one above it.
    for k in range(steps):
        y = 4 + k * (h - 8) / steps
        sh = (h - 8) / steps
        t = k / max(1, steps - 1)
        grey = int(196 - 110 * t)
        parts.append('<rect x="5" y="%.1f" width="%d" height="%.1f" fill="rgb(%d,%d,%d)"/>'
                     % (y, w - 10, sh, grey, grey - 8, grey - 20))
        parts.append('<line x1="5" y1="%.1f" x2="%d" y2="%.1f" stroke="%s" stroke-width="1.1"/>' % (y + sh, w - 5, y + sh, INK))
        parts.append('<line x1="5" y1="%.1f" x2="%d" y2="%.1f" stroke="#e4dccb" stroke-width="0.8" opacity="0.6"/>'
                     % (y + 1, w - 5, y + 1))
    parts.append('<path d="M%.1f,%d l0,30 l-6,-7 M%.1f,%d l6,-7" stroke="%s" stroke-width="1.6" opacity="0.65"/>'
                 % (w / 2, 14, w / 2, 44, INK))
    parts.append('<rect x="5" y="4" width="%d" height="%d" stroke="%s" stroke-width="1"/>' % (w - 10, h - 8, INK))
    return _svg(w, h, "".join(parts))


def brazier(rng):
    w = h = 56
    c = 28
    parts = []
    turn = rng.uniform(0, 120)
    for k in range(3):
        a = math.radians(turn + k * 120)
        parts.append('<line x1="%d" y1="%d" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="3.2"/>'
                     % (c, c, c + math.cos(a) * 25, c + math.sin(a) * 25, IRON))
        parts.append('<circle cx="%.1f" cy="%.1f" r="2.4" fill="%s" stroke="%s" stroke-width="0.7"/>'
                     % (c + math.cos(a) * 25, c + math.sin(a) * 25, IRON, INK))
    parts.append('<circle cx="%d" cy="%d" r="17" fill="%s" stroke="%s" stroke-width="1.4"/>' % (c, c, IRON, INK))
    parts.append('<circle cx="%d" cy="%d" r="13" fill="#2b211b"/>' % (c, c))
    for _ in range(rng.randint(7, 11)):
        x, y = c + rng.uniform(-8, 8), c + rng.uniform(-8, 8)
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" opacity="0.9"/>'
                     % (x, y, rng.uniform(2, 4), rng.choice((EMBER, EMBER, "#b2441f", FLAME))))
    parts.append('<circle cx="%d" cy="%d" r="4" fill="%s" opacity="0.9"/>' % (c, c, FLAME_HOT))
    parts.append('<circle cx="%d" cy="%d" r="15.5" stroke="%s" stroke-width="1" opacity="0.6"/>' % (c, c, BRASS))
    return _svg(w, h, "".join(parts))


def mushrooms(rng):
    w = h = 84
    cap = rng.choice(FUNGUS)
    parts = []
    caps = []
    for _ in range(rng.randint(4, 8)):
        for _try in range(20):
            r = rng.uniform(7, 17)
            x, y = rng.uniform(r + 2, w - r - 2), rng.uniform(r + 2, h - r - 2)
            if all(math.hypot(x - cx, y - cy) > (r + cr) * 0.75 for cx, cy, cr in caps):
                caps.append((x, y, r))
                break
    for x, y, r in sorted(caps, key=lambda c: c[2]):
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#000" opacity="0.2"/>' % (x + r * 0.2, y + r * 0.25, r))
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" stroke="%s" stroke-width="1"/>' % (x, y, r, cap, INK))
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#fff" opacity="0.18"/>'
                     % (x - r * 0.25, y - r * 0.3, r * 0.55))
        for _ in range(int(r / 4)):
            a, d = rng.uniform(0, math.pi * 2), rng.uniform(0.2, 0.7) * r
            parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#f4ecd8" opacity="0.85"/>'
                         % (x + math.cos(a) * d, y + math.sin(a) * d, rng.uniform(0.8, 1.8)))
    return _svg(w, h, "".join(parts))


# ------------------------------------------------------------------ fittings
#
# Plans at the same five feet to seventy pixels: what is built into a room
# rather than carried into it, and the heavier things a workshop or a keep has
# standing about. Added 2026-10-08 (art version 4).

STEEL = "#7c7a78"
STEEL_LIGHT = "#a9a6a2"
SOOT = "#2a2522"


def door(rng):
    # A door is drawn in its frame across a 70 px wall gap, the leaf swung open
    # a little, so it can be laid over a wall at a scale of 1.
    w, h = 84, 70
    body, light, dark = _wood(rng)
    swing = rng.uniform(10, 26)
    parts = [
        '<rect x="0" y="27" width="8" height="16" fill="%s" stroke="%s" stroke-width="1.2"/>' % (STONE_DARK, INK),
        '<rect x="%d" y="27" width="8" height="16" fill="%s" stroke="%s" stroke-width="1.2"/>' % (w - 8, STONE_DARK, INK),
        '<line x1="8" y1="35" x2="%d" y2="35" stroke="%s" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>'
        % (w - 8, INK_SOFT),
        # The arc the leaf sweeps, so it reads as a door and not a plank.
        '<path d="M%d,35 A%d,%d 0 0 0 %.1f,%.1f" stroke="%s" stroke-width="0.9" stroke-dasharray="3 2" opacity="0.7"/>'
        % (w - 8, w - 16, w - 16, 8 + (w - 16) * math.cos(math.radians(swing)),
           35 - (w - 16) * math.sin(math.radians(swing)), INK_SOFT),
        '<g transform="rotate(%.1f 8 35)">' % -swing,
        '<rect x="8" y="31" width="%d" height="8" fill="%s" stroke="%s" stroke-width="1.2"/>' % (w - 16, body, INK),
        _boards(8, 31, w - 16, 8, 2, True, dark, 0.5),
        '<line x1="9" y1="32.5" x2="%d" y2="32.5" stroke="%s" stroke-width="1" opacity="0.7"/>' % (w - 9, light),
        '<rect x="13" y="30" width="5" height="10" fill="%s"/>' % IRON,
        '<rect x="%d" y="30" width="5" height="10" fill="%s"/>' % (w - 30, IRON),
        '<circle cx="%d" cy="35" r="2" fill="%s" stroke="%s" stroke-width="0.6"/>' % (w - 14, BRASS, INK),
        '</g>',
    ]
    return _svg(w, h, "".join(parts))


def portcullis(rng):
    w, h = 148, 40
    bars = rng.choice((6, 7, 8))
    parts = [
        '<rect x="0" y="8" width="14" height="24" fill="%s" stroke="%s" stroke-width="1.3"/>' % (STONE_DARK, INK),
        '<rect x="%d" y="8" width="14" height="24" fill="%s" stroke="%s" stroke-width="1.3"/>' % (w - 14, STONE_DARK, INK),
        # The slot the grate drops through, seen from above.
        '<rect x="14" y="15" width="%d" height="10" fill="%s" opacity="0.85"/>' % (w - 28, SOOT),
    ]
    for k in range(bars):
        x = 18 + (w - 36) * k / (bars - 1)
        parts.append('<rect x="%.1f" y="12" width="4" height="16" rx="1" fill="%s" stroke="%s" stroke-width="0.8"/>'
                     % (x - 2, STEEL, INK))
        parts.append('<path d="M%.1f,12 l2,-4 l2,4" fill="%s" stroke="%s" stroke-width="0.7"/>' % (x - 2, STEEL_LIGHT, INK))
    parts.append('<rect x="14" y="18" width="%d" height="4" fill="%s" stroke="%s" stroke-width="0.8"/>' % (w - 28, IRON, INK))
    for x in (6, w - 8):
        parts.append('<circle cx="%d" cy="20" r="2.4" fill="%s" stroke="%s" stroke-width="0.7"/>' % (x + 1, IRON, INK))
    if rng.random() < 0.5:
        parts.append('<path d="M%d,30 l6,4 l8,-2" stroke="%s" stroke-width="0.8" opacity="0.7"/>' % (w // 3, INK_SOFT))
    return _svg(w, h, "".join(parts))


def trapdoor(rng):
    w = h = 70
    body, light, dark = _wood(rng)
    open_ = rng.random() < 0.34
    parts = ['<rect x="2" y="2" width="66" height="66" fill="%s" stroke="%s" stroke-width="1.4"/>' % (dark, INK)]
    if open_:
        # The hatch thrown back, and a ladder going down into the dark.
        parts.append('<rect x="8" y="8" width="54" height="54" fill="%s"/>' % SOOT)
        for k in range(5):
            y = 14 + k * 10
            parts.append('<rect x="20" y="%d" width="30" height="3" fill="%s" opacity="%.2f"/>' % (y, body, 1 - k * 0.16))
        parts.append('<rect x="18" y="10" width="3" height="52" fill="%s"/><rect x="49" y="10" width="3" height="52" fill="%s"/>'
                     % (body, body))
    else:
        parts.append('<rect x="8" y="8" width="54" height="54" fill="%s" stroke="%s" stroke-width="1"/>' % (body, INK))
        parts.append(_boards(8, 8, 54, 54, rng.choice((4, 5)), rng.random() < 0.5, dark))
        for y in (16, 54):
            parts.append('<rect x="8" y="%d" width="54" height="4" fill="%s"/>' % (y - 2, IRON))
            for x in (12, 58):
                parts.append('<circle cx="%d" cy="%d" r="1" fill="%s"/>' % (x, y, BRASS))
        parts.append('<circle cx="35" cy="35" r="5" stroke="%s" stroke-width="2"/>' % IRON)
        parts.append('<path d="M8,62 L8,8 L62,8" stroke="%s" stroke-width="1.6" opacity="0.6"/>' % light)
    return _svg(w, h, "".join(parts))


def sconce(rng):
    # Set against the north edge of its box, which is where the wall goes: a
    # bracket off the stone, the torch in it, and the light it throws.
    w, h = 56, 48
    lit = rng.random() < 0.8
    parts = []
    if lit:
        parts.append('<circle cx="28" cy="20" r="18" fill="%s" opacity="0.18"/>' % FLAME)
        parts.append('<circle cx="28" cy="20" r="11" fill="%s" opacity="0.22"/>' % FLAME)
    parts += [
        '<rect x="16" y="0" width="24" height="6" fill="%s" stroke="%s" stroke-width="1.1"/>' % (IRON, INK),
        '<path d="M22,6 L25,16 M34,6 L31,16" stroke="%s" stroke-width="2.2"/>' % IRON,
        '<circle cx="28" cy="19" r="6" fill="%s" stroke="%s" stroke-width="1.1"/>' % (IRON, INK),
        '<circle cx="28" cy="19" r="3.6" fill="%s"/>' % (WOOD_DARK if not lit else EMBER),
    ]
    if lit:
        parts.append('<circle cx="28" cy="20" r="2.4" fill="%s"/>' % FLAME)
        parts.append('<circle cx="27.5" cy="19.5" r="1.1" fill="%s"/>' % FLAME_HOT)
    return _svg(w, h, "".join(parts))


def statue(rng):
    w = h = 92
    c = 46
    stone = rng.choice(((STONE, "#d6ccb8", STONE_DARK), ("#c8c2b4", "#e4ded0", "#948e80"),
                        ("#8f8a82", "#b2ada4", "#66625b")))
    body, light, dark = stone
    turn = rng.uniform(0, 360)
    parts = [
        '<rect x="4" y="4" width="84" height="84" rx="4" fill="%s" stroke="%s" stroke-width="1.4"/>' % (CAVE_DARK, INK),
        '<rect x="12" y="12" width="68" height="68" rx="2" fill="%s" stroke="%s" stroke-width="1.1"/>' % (dark, INK),
        '<path d="M12,80 L12,12 L80,12" stroke="%s" stroke-width="2" opacity="0.6"/>' % light,
        '<g transform="rotate(%.1f %d %d)">' % (turn, c, c),
        # A robed figure from above: the hem, the shoulders, the head, and one
        # arm held out with something in the hand.
        '<ellipse cx="%d" cy="%d" rx="24" ry="20" fill="%s" stroke="%s" stroke-width="1.1"/>' % (c, c + 3, body, INK),
        '<path d="M%d,%d q8,-6 16,0 M%d,%d q-8,6 -16,0" stroke="%s" stroke-width="0.8" opacity="0.7"/>'
        % (c - 18, c + 8, c + 18, c - 2, dark),
        '<ellipse cx="%d" cy="%d" rx="17" ry="9" fill="%s" stroke="%s" stroke-width="1"/>' % (c, c - 2, light, INK),
        '<circle cx="%d" cy="%d" r="7" fill="%s" stroke="%s" stroke-width="1"/>' % (c, c - 3, body, INK),
        '<path d="M%d,%d l16,-12" stroke="%s" stroke-width="4.5" stroke-linecap="round"/>' % (c + 12, c - 4, body),
        '<path d="M%d,%d l16,-12" stroke="%s" stroke-width="0.9" fill="none"/>' % (c + 12, c - 6.5, INK),
        '<circle cx="%d" cy="%d" r="%.1f" fill="%s" stroke="%s" stroke-width="0.9"/>'
        % (c + 29, c - 17, rng.uniform(3, 5), light, INK),
        '</g>',
    ]
    if rng.random() < 0.5:
        parts.append('<path d="M%d,%d l5,7 l-3,6" stroke="%s" stroke-width="0.8" opacity="0.7"/>'
                     % (rng.randint(20, 70), rng.randint(16, 30), INK_SOFT))
    return _svg(w, h, "".join(parts))


def anvil(rng):
    w, h = 84, 70
    parts = [
        # The stump it stands on, then the anvil across it: horn to the west.
        '<circle cx="46" cy="35" r="28" fill="%s" stroke="%s" stroke-width="1.2"/>' % (WOOD, INK),
        '<circle cx="46" cy="35" r="20" stroke="%s" stroke-width="0.8" opacity="0.6"/>' % WOOD_DARK,
        '<circle cx="46" cy="35" r="11" stroke="%s" stroke-width="0.8" opacity="0.6"/>' % WOOD_DARK,
        '<path d="M4,35 Q14,25 28,24 L72,24 L72,46 L28,46 Q14,45 4,35 Z" fill="%s" stroke="%s" stroke-width="1.3"/>'
        % (STEEL, INK),
        '<path d="M8,34 Q16,28 28,27.5 L70,27.5" stroke="%s" stroke-width="2" opacity="0.8"/>' % STEEL_LIGHT,
        '<rect x="60" y="30" width="5" height="5" fill="%s"/>' % SOOT,
        '<circle cx="54" cy="40" r="1.6" fill="%s"/>' % SOOT,
    ]
    if rng.random() < 0.6:
        # A hammer left on it.
        a = rng.uniform(-30, 30)
        parts.append('<g transform="rotate(%.1f 46 35)"><rect x="30" y="49" width="30" height="4" rx="1.5" fill="%s" '
                     'stroke="%s" stroke-width="0.8"/><rect x="56" y="45" width="8" height="12" rx="1" fill="%s" '
                     'stroke="%s" stroke-width="0.9"/></g>' % (a, WOOD_LIGHT, INK, IRON, INK))
    return _svg(w, h, "".join(parts))


def cauldron(rng):
    w = h = 76
    c = 38
    brew = rng.choice(("#5d7a3a", "#7a3a5a", "#3a6a7a", "#8a6a2a"))
    parts = []
    for k in range(3):
        a = math.radians(rng.uniform(0, 30) + k * 120)
        parts.append('<circle cx="%.1f" cy="%.1f" r="4" fill="%s" stroke="%s" stroke-width="0.8"/>'
                     % (c + math.cos(a) * 30, c + math.sin(a) * 30, IRON, INK))
    parts += [
        '<circle cx="%d" cy="%d" r="29" fill="%s" stroke="%s" stroke-width="1.4"/>' % (c, c, IRON, INK),
        '<path d="M%d,%d A26,26 0 0 1 %d,%d" stroke="%s" stroke-width="2" opacity="0.6"/>' % (c - 24, c + 4, c + 4, c - 24, STEEL),
        '<circle cx="%d" cy="%d" r="22" fill="%s" stroke="%s" stroke-width="1"/>' % (c, c, brew, SOOT),
    ]
    for _ in range(rng.randint(4, 7)):
        a, d = rng.uniform(0, math.pi * 2), rng.uniform(0, 15)
        r = rng.uniform(1.5, 4)
        parts.append('<circle cx="%.1f" cy="%.1f" r="%.1f" stroke="#ffffff" stroke-width="0.8" opacity="0.45"/>'
                     % (c + math.cos(a) * d, c + math.sin(a) * d, r))
    parts.append('<path d="M%d,%d q4,-4 8,0" stroke="#ffffff" stroke-width="1" opacity="0.35"/>' % (c - 10, c - 6))
    # The handle laid down across the rim.
    parts.append('<path d="M%d,%d A31,31 0 0 0 %d,%d" stroke="%s" stroke-width="2.2"/>' % (c - 29, c + 6, c + 29, c + 6, IRON))
    return _svg(w, h, "".join(parts))


def chair(rng):
    w, h = 44, 44
    body, light, dark = _wood(rng)
    back = rng.choice(("plain", "spindle"))
    parts = [
        '<rect x="5" y="9" width="34" height="31" rx="3" fill="%s" stroke="%s" stroke-width="1.2"/>' % (body, INK),
        _boards(5, 9, 34, 31, 3, False, dark, 0.45),
        '<path d="M6,39 L6,10 L38,10" stroke="%s" stroke-width="1.4" opacity="0.6"/>' % light,
        '<rect x="3" y="2" width="38" height="8" rx="2" fill="%s" stroke="%s" stroke-width="1.2"/>' % (dark, INK),
    ]
    if back == "spindle":
        for x in (12, 19, 26, 33):
            parts.append('<circle cx="%d" cy="6" r="1.4" fill="%s"/>' % (x, light))
    if rng.random() < 0.4:
        parts.append('<rect x="10" y="15" width="24" height="20" rx="4" fill="%s" stroke="%s" stroke-width="0.8" opacity="0.95"/>'
                     % (rng.choice(CLOTHS), INK))
    return _svg(w, h, "".join(parts))


# ---------------------------------------------- the camp and the market
#
# What stands outdoors on a battle map: the camp the party walks into, the
# market square, the road out of town. Plans again, at seventy pixels to five
# feet, lit from the north-west. Added 2026-10-09 (art version 5).

CANVAS = ["#d9c9a3", "#c2b48c", "#a99c7a", "#b58a5c", "#8c9a7a"]
HAY = "#d6b25e"
HAY_LIGHT = "#ecd38c"
HAY_DARK = "#a8843e"


def tent(rng):
    w = h = 140
    cloth = rng.choice(CANVAS)
    if rng.random() < 0.34:
        # A bell tent: a cone of canvas round one pole, its seams running in.
        c, r = 70, 54
        parts = []
        for k in range(10):
            a = math.radians(k * 36 + rng.uniform(-4, 4))
            px, py = c + math.cos(a) * (r + 10), c + math.sin(a) * (r + 10)
            parts.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="0.8" opacity="0.7"/>'
                         % (c + math.cos(a) * r, c + math.sin(a) * r, px, py, INK_SOFT))
            parts.append('<circle cx="%.1f" cy="%.1f" r="1.6" fill="%s"/>' % (px, py, WOOD_DARK))
        parts.append('<circle cx="%d" cy="%d" r="%d" fill="%s" stroke="%s" stroke-width="1.4"/>' % (c, c, r, cloth, INK))
        # The shaded half, away from the light.
        parts.append('<path d="M%.1f,%.1f A%d,%d 0 0 1 %.1f,%.1f L%d,%d Z" fill="%s" opacity="0.28"/>'
                     % (c + r * 0.707, c - r * 0.707, r, r, c - r * 0.707, c + r * 0.707, c, c, INK))
        for k in range(8):
            a = math.radians(k * 45 + 22.5)
            parts.append('<line x1="%d" y1="%d" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="0.8" opacity="0.6"/>'
                         % (c, c, c + math.cos(a) * r, c + math.sin(a) * r, INK_SOFT))
        # The door flap, tied back.
        parts.append('<path d="M%d,%d L%d,%d L%d,%d" fill="%s" stroke="%s" stroke-width="1"/>'
                     % (c - 9, c + r - 2, c, c + r + 8, c + 9, c + r - 2, FILL_DARK, INK))
        parts.append('<circle cx="%d" cy="%d" r="3.5" fill="%s" stroke="%s" stroke-width="0.8"/>' % (c, c, WOOD_LIGHT, INK))
        return _svg(w, h, "".join(parts))
    # A ridge tent: two pitched halves either side of the ridge pole, guy
    # ropes out to pegs, the flap open at the south end.
    x0, x1, y0, y1 = 34, 106, 18, 122
    parts = []
    for gx, gy, px, py in ((x0, y0 + 10, 8, y0), (x1, y0 + 10, 132, y0), (x0, y1 - 10, 8, y1),
                           (x1, y1 - 10, 132, y1), (x0, 70, 6, 70), (x1, 70, 134, 70)):
        parts.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="0.8" opacity="0.75"/>'
                     % (gx, gy, px, py, INK_SOFT))
        parts.append('<rect x="%d" y="%d" width="3" height="3" fill="%s"/>' % (px - 1, py - 1, WOOD_DARK))
    parts += [
        '<rect x="%d" y="%d" width="%d" height="%d" fill="%s" stroke="%s" stroke-width="1.4"/>'
        % (x0, y0, x1 - x0, y1 - y0, cloth, INK),
        '<rect x="70" y="%d" width="%d" height="%d" fill="%s" opacity="0.26"/>' % (y0, x1 - 70, y1 - y0, INK),
        '<line x1="70" y1="%d" x2="70" y2="%d" stroke="%s" stroke-width="2"/>' % (y0 - 4, y1 + 4, WOOD_DARK),
        '<line x1="%d" y1="%d" x2="68" y2="%d" stroke="%s" stroke-width="1.2" opacity="0.7"/>' % (x0 + 2, y0 + 2, y0 + 2, FILL_LIGHT),
    ]
    for k in range(1, 4):
        y = y0 + (y1 - y0) * k / 4
        parts.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="%s" stroke-width="0.7" opacity="0.5"/>'
                     % (x0, y, x1, y, INK_SOFT))
    parts.append('<path d="M70,%d L%d,%d L70,%d Z" fill="%s" stroke="%s" stroke-width="1"/>'
                 % (y1, x0 + 8, y1 + 12, y1 - 4, FILL_DARK, INK))
    if rng.random() < 0.5:
        parts.append('<path d="M%d,%d l6,6 l-3,3 l-6,-6 Z" fill="%s" stroke="%s" stroke-width="0.7"/>'
                     % (x1 - 18, y0 + 14, rng.choice(CLOTHS), INK))
    return _svg(w, h, "".join(parts))


def market_stall(rng):
    w, h = 140, 96
    cloth = rng.choice(CLOTHS)
    body, light, dark = _wood(rng)
    parts = [
        # The counter and the goods set out on it, south of the awning.
        '<rect x="8" y="56" width="124" height="30" fill="%s" stroke="%s" stroke-width="1.2"/>' % (body, INK),
        _boards(8, 56, 124, 30, 2, True, dark, 0.5),
    ]
    goods = rng.choice(("fruit", "cloth", "pots"))
    for k in range(5):
        cx = 18 + k * 26
        parts.append('<rect x="%d" y="60" width="22" height="22" fill="%s" stroke="%s" stroke-width="0.8"/>'
                     % (cx - 4, dark, INK))
        if goods == "fruit":
            col = rng.choice(("#b8442e", "#d79a2c", "#7a9a3a", "#8a3a5a"))
            for j in range(5):
                parts.append('<circle cx="%.1f" cy="%.1f" r="3.2" fill="%s" stroke="%s" stroke-width="0.5"/>'
                             % (cx + 2 + (j % 3) * 5, 65 + (j // 3) * 7 + (j % 2), col, INK))
        elif goods == "cloth":
            parts.append('<rect x="%d" y="63" width="16" height="16" fill="%s" stroke="%s" stroke-width="0.6"/>'
                         % (cx - 1, rng.choice(CLOTHS), INK))
            parts.append('<line x1="%d" y1="67" x2="%d" y2="67" stroke="#ffffff" stroke-width="0.8" opacity="0.4"/>' % (cx, cx + 14))
        else:
            parts.append('<circle cx="%d" cy="71" r="7" fill="#a8613f" stroke="%s" stroke-width="0.8"/>' % (cx + 7, INK))
            parts.append('<circle cx="%d" cy="71" r="3" fill="%s"/>' % (cx + 7, SOOT))
    # The awning: stripes of a dyed cloth and undyed, overhanging the back.
    parts.append('<rect x="2" y="4" width="136" height="50" fill="%s" stroke="%s" stroke-width="1.3"/>' % (FILL_LIGHT, INK))
    for k in range(0, 8, 2):
        parts.append('<rect x="%d" y="4" width="17" height="50" fill="%s"/>' % (2 + k * 17, cloth))
    parts.append('<rect x="2" y="29" width="136" height="25" fill="%s" opacity="0.22"/>' % INK)
    parts.append('<path d="M2,54 %s" stroke="%s" stroke-width="1.2"/>'
                 % (" ".join("q8.5,6 17,0" for _ in range(8)), INK))
    parts.append('<rect x="2" y="4" width="136" height="50" stroke="%s" stroke-width="1.3"/>' % INK)
    return _svg(w, h, "".join(parts))


def signpost(rng):
    w = h = 84
    c = 42
    body, light, dark = _wood(rng)
    parts = []
    arms = rng.choice((2, 3, 3, 4))
    start = rng.uniform(0, 360)
    # Two arms set straight across each other read as one plank, so a pair
    # is set at an angle; more than two share the circle out.
    spread = [0, rng.uniform(80, 140)] if arms == 2 else [k * 360 / arms + rng.uniform(-25, 25) for k in range(arms)]
    for k in range(arms):
        a = start + spread[k]
        parts.append('<g transform="rotate(%.1f %d %d)">' % (a, c, c))
        parts.append('<path d="M%d,%d L%d,%d L%d,%d L%d,%d L%d,%d Z" fill="%s" stroke="%s" stroke-width="1"/>'
                     % (c, c - 4, c + 30, c - 4, c + 37, c, c + 30, c + 4, c, c + 4, body, INK))
        parts.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="0.8" opacity="0.7"/>'
                     % (c + 4, c - 2.5, c + 30, c - 2.5, light))
        parts.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="0.7" opacity="0.6"/>'
                     % (c + 10, c + 1, c + 26, c + 1, INK_SOFT))
        parts.append('</g>')
    parts.append('<circle cx="%d" cy="%d" r="6" fill="%s" stroke="%s" stroke-width="1.2"/>' % (c, c, dark, INK))
    parts.append('<circle cx="%d" cy="%d" r="2.5" stroke="%s" stroke-width="0.7" opacity="0.7"/>' % (c, c, light))
    return _svg(w, h, "".join(parts))


def weapon_rack(rng):
    w, h = 112, 48
    body, light, dark = _wood(rng)
    parts = [
        '<rect x="2" y="8" width="108" height="8" fill="%s" stroke="%s" stroke-width="1.1"/>' % (body, INK),
        '<rect x="2" y="32" width="108" height="8" fill="%s" stroke="%s" stroke-width="1.1"/>' % (body, INK),
        '<rect x="2" y="8" width="6" height="32" fill="%s" stroke="%s" stroke-width="1"/>' % (dark, INK),
        '<rect x="104" y="8" width="6" height="32" fill="%s" stroke="%s" stroke-width="1"/>' % (dark, INK),
        '<line x1="3" y1="10" x2="109" y2="10" stroke="%s" stroke-width="1" opacity="0.7"/>' % light,
    ]
    x = 16
    while x < 100:
        kind = rng.choice(("spear", "sword", "axe", "spear"))
        if kind == "spear":
            parts.append('<line x1="%d" y1="0" x2="%d" y2="48" stroke="%s" stroke-width="2.4"/>' % (x, x, WOOD_DARK))
            parts.append('<path d="M%d,-2 l-3.5,8 l3.5,4 l3.5,-4 Z" fill="%s" stroke="%s" stroke-width="0.7"/>'
                         % (x, STEEL_LIGHT, INK))
            x += rng.randint(10, 14)
        elif kind == "sword":
            parts.append('<path d="M%d,2 l3,4 l0,30 l-6,0 l0,-30 Z" fill="%s" stroke="%s" stroke-width="0.7"/>'
                         % (x, STEEL_LIGHT, INK))
            parts.append('<rect x="%d" y="36" width="12" height="3" fill="%s" stroke="%s" stroke-width="0.6"/>' % (x - 6, BRASS, INK))
            parts.append('<rect x="%d" y="39" width="3" height="8" fill="%s"/>' % (x - 1.5, WOOD_DARK))
            x += rng.randint(13, 16)
        else:
            parts.append('<line x1="%d" y1="4" x2="%d" y2="46" stroke="%s" stroke-width="2.6"/>' % (x, x, WOOD))
            parts.append('<path d="M%d,6 q9,2 9,9 q-9,-1 -9,4 Z" fill="%s" stroke="%s" stroke-width="0.8"/>'
                         % (x, STEEL, INK))
            x += rng.randint(15, 18)
    return _svg(w, h, "".join(parts))


def bedroll(rng):
    w, h = 44, 92
    cloth = rng.choice(CLOTHS + CANVAS[:2])
    parts = []
    if rng.random() < 0.5:
        # Laid out to sleep in, the blanket turned back at the head.
        parts += [
            '<rect x="6" y="6" width="32" height="80" rx="5" fill="%s" stroke="%s" stroke-width="1.2"/>' % (cloth, INK),
            '<rect x="6" y="24" width="32" height="62" rx="4" fill="%s" opacity="0.25"/>' % INK,
            '<path d="M6,26 q16,-6 32,0" stroke="%s" stroke-width="1.4"/>' % INK,
            '<rect x="11" y="9" width="22" height="13" rx="5" fill="%s" stroke="%s" stroke-width="1"/>' % (FILL_LIGHT, INK),
            '<line x1="8" y1="40" x2="36" y2="40" stroke="%s" stroke-width="0.7" opacity="0.5"/>' % INK_SOFT,
            '<line x1="8" y1="62" x2="36" y2="62" stroke="%s" stroke-width="0.7" opacity="0.5"/>' % INK_SOFT,
        ]
    else:
        # Rolled and tied, with a pack beside it.
        parts += [
            '<rect x="4" y="30" width="36" height="22" rx="10" fill="%s" stroke="%s" stroke-width="1.2"/>' % (cloth, INK),
            '<path d="M8,34 q14,-4 28,0" stroke="#ffffff" stroke-width="1.2" opacity="0.35"/>',
            '<line x1="13" y1="30" x2="13" y2="52" stroke="%s" stroke-width="1.8"/>' % WOOD_DARK,
            '<line x1="31" y1="30" x2="31" y2="52" stroke="%s" stroke-width="1.8"/>' % WOOD_DARK,
            '<rect x="10" y="60" width="24" height="24" rx="5" fill="%s" stroke="%s" stroke-width="1.1"/>' % (WOOD_LIGHT, INK),
            '<path d="M10,68 q12,6 24,0" fill="%s" stroke="%s" stroke-width="0.9"/>' % (WOOD, INK),
            '<rect x="20" y="70" width="4" height="5" fill="%s"/>' % BRASS,
        ]
    return _svg(w, h, "".join(parts))


def haystack(rng):
    w = h = 92
    c = 46
    r = rng.uniform(36, 41)
    parts = ['<circle cx="%d" cy="%d" r="%.1f" fill="%s" stroke="%s" stroke-width="1.3"/>' % (c, c, r, HAY, INK)]
    # The thatch of the top, laid in rings round the crown.
    for ring in (0.82, 0.6, 0.38):
        rr = r * ring
        for k in range(int(28 * ring)):
            a = rng.uniform(0, math.pi * 2)
            ln = rng.uniform(0.3, 0.6)
            parts.append('<path d="M%.1f,%.1f A%.1f,%.1f 0 0 1 %.1f,%.1f" stroke="%s" stroke-width="0.9" opacity="0.8"/>'
                         % (c + math.cos(a) * rr, c + math.sin(a) * rr, rr, rr,
                            c + math.cos(a + ln) * rr, c + math.sin(a + ln) * rr,
                            HAY_DARK if k % 3 else HAY_LIGHT))
    parts.append('<path d="M%.1f,%.1f A%.1f,%.1f 0 0 1 %.1f,%.1f L%d,%d Z" fill="%s" opacity="0.22"/>'
                 % (c + r * 0.707, c - r * 0.707, r, r, c - r * 0.707, c + r * 0.707, c, c, INK))
    for _ in range(rng.randint(5, 9)):
        a = rng.uniform(0, math.pi * 2)
        d = r + rng.uniform(1, 6)
        b = a + rng.uniform(-0.6, 0.6)
        parts.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="0.9"/>'
                     % (c + math.cos(a) * d, c + math.sin(a) * d, c + math.cos(a) * d + math.cos(b) * 7,
                        c + math.sin(a) * d + math.sin(b) * 7, HAY_DARK))
    parts.append('<circle cx="%d" cy="%d" r="4" fill="%s" stroke="%s" stroke-width="0.8"/>' % (c, c, HAY_LIGHT, INK))
    return _svg(w, h, "".join(parts))


def cart(rng):
    w, h = 84, 150
    body, light, dark = _wood(rng)
    parts = [
        # Shafts out to the north, for the horse or the ox.
        '<line x1="30" y1="2" x2="34" y2="48" stroke="%s" stroke-width="3"/>' % dark,
        '<line x1="54" y1="2" x2="50" y2="48" stroke="%s" stroke-width="3"/>' % dark,
        '<line x1="30" y1="10" x2="54" y2="10" stroke="%s" stroke-width="2"/>' % dark,
        # The wheels, seen edge on, either side of the axle.
        '<rect x="2" y="78" width="9" height="44" rx="3" fill="%s" stroke="%s" stroke-width="1.1"/>' % (WOOD_DARK, INK),
        '<rect x="73" y="78" width="9" height="44" rx="3" fill="%s" stroke="%s" stroke-width="1.1"/>' % (WOOD_DARK, INK),
        '<rect x="4" y="78" width="5" height="44" fill="%s" opacity="0.8"/>' % IRON,
        '<rect x="75" y="78" width="5" height="44" fill="%s" opacity="0.8"/>' % IRON,
        '<rect x="12" y="44" width="60" height="102" fill="%s" stroke="%s" stroke-width="1.3"/>' % (body, INK),
        '<rect x="16" y="48" width="52" height="94" fill="%s" stroke="%s" stroke-width="0.9"/>' % (dark, INK),
        _boards(16, 48, 52, 94, 5, False, body, 0.6),
        '<line x1="13" y1="45" x2="71" y2="45" stroke="%s" stroke-width="1.2" opacity="0.8"/>' % light,
        '<line x1="13" y1="45" x2="13" y2="145" stroke="%s" stroke-width="1.2" opacity="0.8"/>' % light,
    ]
    load = rng.choice(("sacks", "barrels", "empty", "sacks"))
    if load == "sacks":
        for k in range(rng.randint(3, 5)):
            x, y = 20 + (k % 2) * 22, 54 + (k // 2) * 28 + rng.uniform(-3, 3)
            parts.append('<rect x="%.1f" y="%.1f" width="22" height="26" rx="8" fill="%s" stroke="%s" stroke-width="0.9"/>'
                         % (x, y, rng.choice(CANVAS), INK))
            parts.append('<path d="M%.1f,%.1f l4,-3 l4,3" stroke="%s" stroke-width="0.9"/>' % (x + 7, y + 4, INK_SOFT))
    elif load == "barrels":
        for k in range(4):
            x, y = 29 + (k % 2) * 26, 70 + (k // 2) * 40
            parts.append('<circle cx="%d" cy="%d" r="12" fill="%s" stroke="%s" stroke-width="1"/>' % (x, y, WOOD_LIGHT, INK))
            parts.append('<circle cx="%d" cy="%d" r="9" stroke="%s" stroke-width="1.2"/>' % (x, y, IRON))
    return _svg(w, h, "".join(parts))


def woodpile(rng):
    w, h = 96, 60
    parts = ['<rect x="2" y="6" width="92" height="50" rx="3" fill="%s" opacity="0.35"/>' % SOOT]
    for row in range(3):
        y = 8 + row * 16
        x = 4 + rng.uniform(-2, 3)
        while x < 86:
            ln = rng.uniform(26, 40)
            ln = min(ln, 92 - x)
            if ln < 12:
                break
            bark = rng.choice((WOOD_DARK, "#5e4630", TRUNK))
            parts.append('<rect x="%.1f" y="%d" width="%.1f" height="14" rx="6" fill="%s" stroke="%s" stroke-width="1"/>'
                         % (x, y, ln, bark, INK))
            parts.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s" stroke-width="0.8" opacity="0.6"/>'
                         % (x + 4, y + 4, x + ln - 6, y + 4, WOOD_LIGHT))
            # The sawn end, rings and all.
            parts.append('<ellipse cx="%.1f" cy="%d" rx="4" ry="6.5" fill="%s" stroke="%s" stroke-width="0.8"/>'
                         % (x + ln - 4, y + 7, "#d8b688", INK))
            parts.append('<ellipse cx="%.1f" cy="%d" rx="1.8" ry="3" stroke="%s" stroke-width="0.6"/>'
                         % (x + ln - 4, y + 7, WOOD))
            x += ln + rng.uniform(0, 3)
    if rng.random() < 0.5:
        parts.append('<g transform="rotate(%.1f 70 30)"><rect x="56" y="27" width="30" height="4" rx="1.5" fill="%s" '
                     'stroke="%s" stroke-width="0.8"/><path d="M84,23 l8,4 l0,4 l-8,4 Z" fill="%s" stroke="%s" '
                     'stroke-width="0.8"/></g>' % (rng.uniform(-30, 30), WOOD_LIGHT, INK, STEEL, INK))
    return _svg(w, h, "".join(parts))


CATALOGUE = [
    ("mountain-peak", "Mountain", "terrain", lambda r: mountain(r, False, 1)),
    ("mountain-range", "Mountain Range", "terrain", lambda r: mountain(r, False, 3)),
    ("mountain-snow", "Snowcapped Peak", "terrain", lambda r: mountain(r, True, 2)),
    ("volcano", "Volcano", "terrain", volcano),
    ("hill", "Hills", "terrain", lambda r: hill(r, False)),
    ("hill-wooded", "Wooded Hills", "terrain", lambda r: hill(r, True)),
    ("cave", "Cave Mouth", "terrain", cave),
    ("standing-stones", "Standing Stones", "terrain", standing_stones),
    ("pine", "Pine", "flora", pine),
    ("broadleaf", "Broadleaf Tree", "flora", broadleaf),
    ("palm", "Palm", "flora", palm),
    ("dead-tree", "Dead Tree", "flora", dead_tree),
    ("pine-cluster", "Pine Stand", "flora", lambda r: tree_cluster(r, "pine")),
    ("broadleaf-cluster", "Woodland", "flora", lambda r: tree_cluster(r, "broadleaf")),
    ("swamp-tuft", "Reeds", "flora", swamp_tuft),
    ("cactus", "Cactus", "flora", cactus),
    ("village", "Village", "settlement", village),
    ("town", "Town", "settlement", town),
    ("city", "City", "settlement", city),
    ("castle", "Castle", "settlement", castle),
    ("tower", "Watchtower", "settlement", tower),
    ("ruin", "Ruins", "settlement", ruin),
    ("windmill", "Windmill", "settlement", windmill),
    ("lighthouse", "Lighthouse", "settlement", lighthouse),
    ("mine", "Mine", "settlement", mine),
    ("bridge", "Bridge", "settlement", bridge),
    ("ship", "Ship", "sea", ship),
    ("sea-serpent", "Sea Serpent", "sea", sea_serpent),
    ("compass-rose", "Compass Rose", "decor", compass_rose),
    ("barrel", "Barrel", "furnishing", barrel),
    ("crate", "Crate", "furnishing", crate),
    ("table", "Table", "furnishing", table),
    ("bed", "Bed", "furnishing", bed),
    ("chest", "Chest", "furnishing", chest),
    ("bookshelf", "Bookshelf", "furnishing", bookshelf),
    ("rug", "Rug", "furnishing", rug),
    ("well", "Well", "furnishing", well),
    ("pillar", "Pillar", "underground", pillar),
    ("stalagmites", "Stalagmites", "underground", stalagmites),
    ("rubble", "Rubble", "underground", rubble),
    ("campfire", "Campfire", "underground", campfire),
    ("altar", "Altar", "underground", altar),
    ("stairs", "Stairs Down", "underground", stairs),
    ("brazier", "Brazier", "underground", brazier),
    ("mushrooms", "Cave Mushrooms", "underground", mushrooms),
    ("door", "Door", "fittings", door),
    ("portcullis", "Portcullis", "fittings", portcullis),
    ("trapdoor", "Trapdoor", "fittings", trapdoor),
    ("sconce", "Wall Torch", "fittings", sconce),
    ("statue", "Statue", "fittings", statue),
    ("anvil", "Anvil", "fittings", anvil),
    ("cauldron", "Cauldron", "fittings", cauldron),
    ("chair", "Chair", "fittings", chair),
    ("tent", "Tent", "camp", tent),
    ("market-stall", "Market Stall", "camp", market_stall),
    ("signpost", "Signpost", "camp", signpost),
    ("weapon-rack", "Weapon Rack", "camp", weapon_rack),
    ("bedroll", "Bedroll", "camp", bedroll),
    ("haystack", "Haystack", "camp", haystack),
    ("cart", "Cart", "camp", cart),
    ("woodpile", "Woodpile", "camp", woodpile),
]

# Symbols drawn in three random variants, which the Stamp tool mixes so a
# scatter of them does not look stencilled.
VARIED = ("terrain", "flora", "furnishing", "underground", "fittings", "camp")


def build(seed):
    """Return [(id, label, group, variant_index, svg_text), ...]."""
    out = []
    for sid, label, group, fn in CATALOGUE:
        variants = 3 if group in VARIED else 1
        for v in range(variants):
            rng = random.Random("%s:%s:%d" % (sid, seed, v))
            name = sid if v == 0 else "%s-%d" % (sid, v + 1)
            out.append((name, label, group, v, fn(rng)))
    return out
