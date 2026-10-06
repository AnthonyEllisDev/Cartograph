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
]

# Symbols drawn in three random variants, which the Stamp tool mixes so a
# scatter of them does not look stencilled.
VARIED = ("terrain", "flora", "furnishing")


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
