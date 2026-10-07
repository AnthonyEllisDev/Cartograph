"""Seamless terrain tiles for the starter pack.

Each material is a small recipe: a couple of colour stops, a noise field to
interpolate between them, and some optional grain on top. Everything wraps, so
a tile can be repeated across a map with no visible seam.
"""

import math
import random

from tools.noise import fbm, ridged, warp, clamp, mix, mix_rgb


def _blob(px, size, cx, cy, r, rgb, alpha, feather=0.55):
    """Composite a soft round patch, wrapping at the tile edges."""
    r = max(1.0, r)
    inner = r * (1.0 - feather)
    x0, x1 = int(cx - r) - 1, int(cx + r) + 1
    y0, y1 = int(cy - r) - 1, int(cy + r) + 1
    for y in range(y0, y1 + 1):
        wy = y % size
        for x in range(x0, x1 + 1):
            d = math.hypot(x - cx, y - cy)
            if d > r:
                continue
            a = alpha if d <= inner else alpha * (1.0 - (d - inner) / (r - inner + 1e-6))
            if a <= 0.002:
                continue
            i = (wy * size + (x % size)) * 4
            px[i] = int(px[i] + (rgb[0] - px[i]) * a)
            px[i + 1] = int(px[i + 1] + (rgb[1] - px[i + 1]) * a)
            px[i + 2] = int(px[i + 2] + (rgb[2] - px[i + 2]) * a)


def _speckle(px, size, rng, count, rgb, alpha, rmin, rmax):
    for _ in range(count):
        _blob(px, size, rng.random() * size, rng.random() * size,
              rng.uniform(rmin, rmax), rgb, alpha, 0.85)


# Each entry: colour stops low->high, the field that drives them, and a grain pass.
TERRAINS = {
    "parchment": dict(
        group="base", label="Parchment",
        stops=[(226, 208, 172), (243, 230, 201), (214, 192, 152)],
        cells=3, octaves=5, kind="fbm", contrast=0.55,
        grain=[(90, (166, 140, 100), 0.10, 0.4, 1.4), (40, (255, 250, 235), 0.10, 1.0, 3.0)]),
    "parchment-dark": dict(
        group="base", label="Aged Parchment",
        stops=[(186, 162, 120), (211, 189, 148), (160, 133, 94)],
        cells=3, octaves=5, kind="fbm", contrast=0.7,
        grain=[(140, (120, 96, 62), 0.12, 0.4, 1.6)]),
    "ocean": dict(
        group="water", label="Deep Ocean",
        stops=[(24, 58, 92), (38, 84, 126), (52, 108, 150)],
        cells=2, octaves=4, kind="fbm", contrast=0.5,
        grain=[(50, (120, 170, 200), 0.08, 1.0, 3.5)]),
    "shallows": dict(
        group="water", label="Shallow Water",
        stops=[(58, 118, 156), (92, 158, 188), (128, 190, 208)],
        cells=3, octaves=4, kind="fbm", contrast=0.45,
        grain=[(70, (180, 220, 232), 0.10, 0.8, 2.6)]),
    "grass": dict(
        group="land", label="Grassland",
        stops=[(96, 126, 66), (124, 154, 82), (146, 172, 96)],
        cells=4, octaves=5, kind="fbm", contrast=0.5,
        grain=[(260, (84, 112, 58), 0.16, 0.5, 1.6), (120, (168, 190, 116), 0.12, 0.5, 1.4)]),
    "meadow": dict(
        group="land", label="Meadow",
        stops=[(140, 164, 92), (172, 190, 114), (196, 208, 138)],
        cells=4, octaves=5, kind="fbm", contrast=0.42,
        grain=[(200, (126, 150, 82), 0.14, 0.5, 1.5), (90, (226, 226, 170), 0.14, 0.5, 1.4)]),
    "forest": dict(
        group="land", label="Broadleaf Forest",
        stops=[(44, 72, 40), (62, 94, 50), (78, 112, 58)],
        cells=4, octaves=4, kind="fbm", contrast=0.55,
        canopy=(70, (34, 58, 34), (96, 128, 68), 5.0, 11.0)),
    "pine-forest": dict(
        group="land", label="Pine Forest",
        stops=[(32, 58, 48), (44, 76, 58), (58, 92, 66)],
        cells=4, octaves=4, kind="fbm", contrast=0.55,
        canopy=(84, (24, 44, 38), (74, 108, 76), 4.0, 8.5)),
    "sand": dict(
        group="land", label="Desert Sand",
        stops=[(196, 168, 116), (222, 196, 144), (238, 216, 170)],
        cells=3, octaves=5, kind="fbm", contrast=0.45,
        grain=[(180, (176, 146, 96), 0.10, 0.4, 1.3)]),
    "dunes": dict(
        group="land", label="Dunes",
        stops=[(184, 154, 104), (216, 188, 134), (240, 220, 176)],
        cells=3, octaves=4, kind="fbm", contrast=0.6, warp=0.02,
        bands=(4, 2, 0.55),
        grain=[(120, (164, 134, 88), 0.08, 0.4, 1.2)]),
    "rock": dict(
        group="land", label="Bare Rock",
        stops=[(96, 92, 88), (128, 124, 118), (158, 154, 146)],
        cells=5, octaves=6, kind="ridged", contrast=0.42, warp=0.015,
        grain=[(180, (72, 70, 68), 0.16, 0.5, 2.0)]),
    "highland": dict(
        group="land", label="Highland",
        stops=[(112, 106, 84), (140, 132, 104), (168, 158, 126)],
        cells=5, octaves=6, kind="ridged", contrast=0.5, warp=0.015,
        grain=[(160, (88, 84, 66), 0.14, 0.5, 1.8)]),
    "snow": dict(
        group="land", label="Snowfield",
        stops=[(206, 214, 224), (230, 236, 244), (246, 250, 255)],
        cells=3, octaves=5, kind="fbm", contrast=0.4,
        grain=[(80, (176, 190, 208), 0.14, 0.8, 2.6)]),
    "tundra": dict(
        group="land", label="Tundra",
        stops=[(140, 146, 130), (168, 172, 152), (192, 194, 172)],
        cells=4, octaves=5, kind="fbm", contrast=0.5,
        grain=[(200, (118, 124, 108), 0.14, 0.5, 1.6)]),
    "swamp": dict(
        group="land", label="Marsh",
        stops=[(66, 78, 54), (88, 98, 62), (110, 116, 74)],
        cells=4, octaves=4, kind="fbm", contrast=0.6,
        grain=[(90, (54, 70, 62), 0.22, 1.2, 3.4), (60, (126, 140, 96), 0.12, 0.6, 1.8)]),
    "farmland": dict(
        group="land", label="Farmland",
        stops=[(154, 140, 84), (176, 162, 100), (196, 182, 120)],
        cells=7, octaves=3, kind="fbm", contrast=0.85, warp=0.01,
        furrows=True,
        grain=[(120, (134, 122, 72), 0.12, 0.4, 1.4)]),
    "ash": dict(
        group="land", label="Ashland",
        stops=[(58, 54, 56), (82, 76, 76), (108, 100, 98)],
        cells=3, octaves=5, kind="fbm", contrast=0.6,
        grain=[(150, (40, 36, 38), 0.2, 0.5, 2.2), (40, (168, 96, 60), 0.18, 0.6, 1.8)]),
    # Floors for battle maps. Everything above is ground seen from a mile up;
    # a dungeon at five feet to the square wants what was laid by hand. These
    # are built rather than noised: the joints are what make them read.
    "flagstone": dict(
        group="floor", label="Flagstone Floor", pattern="flagstone",
        stops=[(104, 100, 94), (132, 127, 118), (156, 150, 138)],
        grout=(58, 54, 50), rows=4, slabs=(3, 4),
        grain=[(160, (88, 84, 78), 0.14, 0.4, 1.4), (50, (176, 170, 158), 0.10, 0.6, 1.8)]),
    "planks": dict(
        group="floor", label="Wooden Floorboards", pattern="planks",
        stops=[(106, 72, 44), (134, 94, 58), (160, 118, 76)],
        grout=(52, 34, 22), boards=16,
        grain=[(70, (92, 62, 38), 0.12, 0.4, 1.2)]),
    "cobblestone": dict(
        group="floor", label="Cobblestones", pattern="cobble",
        stops=[(98, 96, 92), (128, 124, 116), (160, 154, 142)],
        grout=(64, 60, 54), cells=12,
        grain=[(120, (84, 80, 74), 0.12, 0.4, 1.2)]),
    # Underground, for the cavern generator: a floor nobody laid, and the two
    # things a cave floor gives way to. Added 2026-10-07 (art version 3).
    "cave-floor": dict(
        group="floor", label="Cave Floor",
        stops=[(74, 67, 60), (98, 90, 80), (124, 115, 102)],
        cells=4, octaves=6, kind="fbm", contrast=0.5, warp=0.03,
        grain=[(240, (62, 56, 50), 0.30, 0.6, 1.6), (130, (146, 136, 120), 0.26, 0.6, 1.5),
               (36, (54, 48, 42), 0.24, 1.6, 3.2)]),
    "cave-water": dict(
        group="water", label="Underground Pool",
        stops=[(12, 28, 36), (20, 46, 56), (32, 68, 78)],
        cells=3, octaves=5, kind="fbm", contrast=0.5,
        grain=[(60, (84, 134, 146), 0.10, 1.0, 3.0), (30, (8, 18, 24), 0.18, 1.5, 3.5)]),
    "lava": dict(
        group="floor", label="Lava Flow", pattern="lava",
        stops=[(30, 24, 22), (48, 36, 32), (70, 52, 44)],
        glow=[(255, 236, 150), (250, 150, 40), (180, 50, 20)], cells=7,
        grain=[(90, (24, 18, 16), 0.25, 0.5, 1.6)]),
}


def _wrap_gap(a, b, size):
    """Distance between two positions on a circle of the given size."""
    d = abs(a - b) % size
    return min(d, size - d)


def _shade(rgb, k):
    """Lighten (k > 0) or darken (k < 0) a colour by a fraction."""
    if k >= 0:
        return tuple(int(c + (255 - c) * k) for c in rgb)
    return tuple(int(c * (1.0 + k)) for c in rgb)


def _put(px, i, rgb):
    j = i * 4
    px[j], px[j + 1], px[j + 2], px[j + 3] = rgb[0], rgb[1], rgb[2], 255


def _flagstone(spec, size, rng):
    """Courses of squared slabs, each its own stone, the joints staggered."""
    lo, mid, hi = spec["stops"]
    rows = spec["rows"]
    rh = size / rows
    courses = []
    for _ in range(rows):
        n = rng.randint(*spec["slabs"])
        cuts = sorted(rng.uniform(0, size) for _ in range(n))
        # Slabs narrower than a third of a course read as rubble, not paving.
        while any(_wrap_gap(a, b, size) < rh * 0.55 for a, b in zip(cuts, cuts[1:] + cuts[:1])):
            cuts = sorted(rng.uniform(0, size) for _ in range(n))
        courses.append((cuts, [rng.random() for _ in cuts]))
    tone = fbm(size, 4, 4, rng)
    # A wobble on the joints: a stone edge is dressed by hand, not ruled. The
    # fields wrap, so the wobble does too.
    wx, wy = fbm(size, 6, 2, rng), fbm(size, 6, 2, rng)
    px = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            i = y * size + x
            sx = (x + (wx[i] - 0.5) * 5.0) % size
            sy = (y + (wy[i] - 0.5) * 5.0) % size
            r = int(sy / rh) % rows
            cuts, tones = courses[r]
            k = 0
            while k < len(cuts) and cuts[k] <= sx:
                k += 1
            slab = (k - 1) % len(cuts)
            left = min(_wrap_gap(sx, c, size) for c in cuts)
            top = sy - r * rh
            bottom = rh - top
            edge = min(left, top, bottom)
            if edge < 1.3:
                _put(px, i, spec["grout"])
                continue
            v = clamp(0.5 + (tones[slab] - 0.5) * 0.7 + (tone[i] - 0.5) * 0.9)
            rgb = mix_rgb(lo, mid, v * 2.0) if v < 0.5 else mix_rgb(mid, hi, (v - 0.5) * 2.0)
            # A worn arris: light along the top of each slab, shadow along the
            # bottom, as if lit from the north like every symbol in the pack.
            if edge < 4.0:
                if top == edge:
                    rgb = _shade(rgb, 0.12 * (1.0 - edge / 4.0))
                elif bottom == edge:
                    rgb = _shade(rgb, -0.22 * (1.0 - edge / 4.0))
                else:
                    rgb = _shade(rgb, -0.10 * (1.0 - edge / 4.0))
            _put(px, i, rgb)
    return px


def _planks(spec, size, rng):
    """Boards laid along x, each sawn to its own length, with grain and nails."""
    lo, mid, hi = spec["stops"]
    n = spec["boards"]
    bh = size / n
    boards = []
    for _ in range(n):
        joints = sorted(rng.uniform(0, size) for _ in range(rng.choice((1, 2, 2))))
        boards.append((joints, rng.random(), rng.uniform(0, 1)))
    tone = fbm(size, 4, 3, rng)
    wave = fbm(size, 8, 3, rng)
    px = bytearray(size * size * 4)
    for y in range(size):
        b = int(y / bh) % n
        joints, t, phase = boards[b]
        yy = y - b * bh
        for x in range(size):
            i = y * size + x
            if yy < 1.0:
                _put(px, i, spec["grout"])
                continue
            near = min(_wrap_gap(x, j, size) for j in joints)
            if near < 0.8:
                _put(px, i, spec["grout"])
                continue
            # Grain runs the length of the board. A sine across it, bent by a
            # wrapping field, keeps the tile seamless in x without any seam
            # work: nothing here depends on x except through the field.
            g = 0.5 + 0.5 * math.sin(2 * math.pi * (yy / bh * 2.2 + phase + (wave[i] - 0.5) * 2.4))
            v = clamp(0.5 + (t - 0.5) * 0.6 + (tone[i] - 0.5) * 0.6 - (g ** 6) * 0.35)
            rgb = mix_rgb(lo, mid, v * 2.0) if v < 0.5 else mix_rgb(mid, hi, (v - 0.5) * 2.0)
            if yy < 2.2:
                rgb = _shade(rgb, 0.10)
            elif yy > bh - 1.6:
                rgb = _shade(rgb, -0.16)
            _put(px, i, rgb)
    # A nail either side of every joint, where a carpenter would put them.
    for b, (joints, _t, _p) in enumerate(boards):
        cy = b * bh + bh / 2
        for j in joints:
            for dx in (-3.5, 3.5):
                _blob(px, size, j + dx, cy, 1.3, (48, 40, 34), 0.85, 0.3)
    for _ in range(rng.randint(2, 4)):
        b = rng.randrange(n)
        kx, ky = rng.uniform(0, size), b * bh + bh / 2
        _blob(px, size, kx, ky, rng.uniform(2.0, 3.2), (82, 54, 32), 0.7, 0.5)
    return px


def _cobble(spec, size, rng):
    """Rounded setts packed in mortar: a wrapping Worley field, F2 - F1."""
    lo, mid, hi = spec["stops"]
    n = spec["cells"]
    cell = size / n
    pts = [[((cx + rng.uniform(0.2, 0.8)) * cell, (cy + rng.uniform(0.2, 0.8)) * cell, rng.random())
            for cx in range(n)] for cy in range(n)]
    tone = fbm(size, 6, 3, rng)
    px = bytearray(size * size * 4)
    for y in range(size):
        gy = int(y / cell)
        for x in range(size):
            gx = int(x / cell)
            f1 = f2 = 1e9
            near = None
            for oy in (-1, 0, 1):
                for ox in (-1, 0, 1):
                    cx, cy = gx + ox, gy + oy
                    px0, py0, t = pts[cy % n][cx % n]
                    # Shift the point by a whole tile when its cell wrapped,
                    # so distances are measured on the torus.
                    px0 += (cx - cx % n) * cell
                    py0 += (cy - cy % n) * cell
                    d = math.hypot(x - px0, y - py0)
                    if d < f1:
                        f1, f2, near = d, f1, (px0, py0, t)
                    elif d < f2:
                        f2 = d
            i = y * size + x
            edge = (f2 - f1) / 2.0
            if edge < 1.4:
                _put(px, i, spec["grout"])
                continue
            nx, ny, t = near
            v = clamp(0.5 + (t - 0.5) * 0.8 + (tone[i] - 0.5) * 0.5)
            rgb = mix_rgb(lo, mid, v * 2.0) if v < 0.5 else mix_rgb(mid, hi, (v - 0.5) * 2.0)
            # A dome, lit from the north-west: the side of each stone facing
            # the light is brighter, the far side falls into the joint.
            if f1 > 0.5:
                lit = ((x - nx) * -0.6 + (y - ny) * -0.8) / f1
                rim = clamp(1.0 - edge / 6.0)
                rgb = _shade(rgb, (0.16 if lit > 0 else 0.26) * lit * rim)
            _put(px, i, rgb)
    return px


def _lava(spec, size, rng):
    """Plates of cooled crust floating on a melt that shows through the cracks.

    The same wrapping Worley field as the cobbles, read the other way round:
    the joints are the bright part, and the heat bleeds a little way into the
    crust either side of them."""
    lo, mid, hi = spec["stops"]
    white, orange, red = spec["glow"]
    n = spec["cells"]
    cell = size / n
    pts = [[((cx + rng.uniform(0.15, 0.85)) * cell, (cy + rng.uniform(0.15, 0.85)) * cell, rng.random())
            for cx in range(n)] for cy in range(n)]
    tone = fbm(size, 8, 4, rng)
    heat = fbm(size, 3, 3, rng)
    px = bytearray(size * size * 4)
    for y in range(size):
        gy = int(y / cell)
        for x in range(size):
            gx = int(x / cell)
            f1 = f2 = 1e9
            t = 0.0
            for oy in (-1, 0, 1):
                for ox in (-1, 0, 1):
                    cx, cy = gx + ox, gy + oy
                    px0, py0, tt = pts[cy % n][cx % n]
                    px0 += (cx - cx % n) * cell
                    py0 += (cy - cy % n) * cell
                    d = math.hypot(x - px0, y - py0)
                    if d < f1:
                        f1, f2, t = d, f1, tt
                    elif d < f2:
                        f2 = d
            i = y * size + x
            # The width of a crack varies along it, so the melt does not read
            # as a ruled grid.
            edge = (f2 - f1) / 2.0 - (heat[i] - 0.5) * 4.0
            if edge < 0.9:
                rgb = mix_rgb(white, orange, clamp(edge / 0.9))
            elif edge < 2.2:
                rgb = mix_rgb(orange, red, (edge - 0.9) / 1.3)
            else:
                v = clamp(0.5 + (t - 0.5) * 0.6 + (tone[i] - 0.5) * 0.8)
                rgb = mix_rgb(lo, mid, v * 2.0) if v < 0.5 else mix_rgb(mid, hi, (v - 0.5) * 2.0)
                if edge < 5.0:
                    rgb = mix_rgb(rgb, red, 0.45 * (1.0 - (edge - 2.2) / 2.8))
            _put(px, i, rgb)
    return px


PATTERNS = {"flagstone": _flagstone, "planks": _planks, "cobble": _cobble, "lava": _lava}


def render(name, size, seed):
    """Return RGBA bytes for one seamless terrain tile."""
    spec = TERRAINS[name]
    rng = random.Random("%s:%s" % (name, seed))
    if spec.get("pattern"):
        px = PATTERNS[spec["pattern"]](spec, size, rng)
        for count, rgb, alpha, rmin, rmax in spec.get("grain", []):
            _speckle(px, size, rng, count, rgb, alpha, rmin, rmax)
        return bytes(px)
    kind = spec.get("kind", "fbm")
    field = (ridged if kind == "ridged" else fbm)(size, spec["cells"], spec["octaves"], rng)
    # A light domain warp kills the faint square banding that low-octave value
    # noise leaves behind, and costs one extra pair of cheap fields.
    field = warp(field, size,
                 fbm(size, 8, 3, rng), fbm(size, 8, 3, rng),
                 size * spec.get("warp", 0.035))

    if spec.get("bands"):
        # Dunes and strata need a direction. A sine across the tile at a whole
        # number of periods stays seamless; the noise field bends it so it does
        # not read as corduroy.
        # Whole-number wave counts in x and y: any other angle puts a phase
        # jump at the tile edge, and the seam shows the moment it is repeated.
        kx, ky, depth = spec["bands"]
        for y in range(size):
            for x in range(size):
                i = y * size + x
                u = (kx * x + ky * y) / size
                b = 0.5 + 0.5 * math.sin(2 * math.pi * (u + (field[i] - 0.5) * 0.55))
                field[i] = clamp(field[i] * (1.0 - depth) + b * depth)

    lo, mid, hi = spec["stops"]
    contrast = spec.get("contrast", 0.5)
    px = bytearray(size * size * 4)
    for i in range(size * size):
        v = clamp((field[i] - 0.5) / max(0.05, contrast) + 0.5)
        rgb = mix_rgb(lo, mid, v * 2.0) if v < 0.5 else mix_rgb(mid, hi, (v - 0.5) * 2.0)
        j = i * 4
        px[j], px[j + 1], px[j + 2], px[j + 3] = rgb[0], rgb[1], rgb[2], 255

    if spec.get("furrows"):
        # Farmland reads as farmland because of the plough lines, not the colour.
        for _ in range(6):
            ang = rng.choice([0.0, math.pi / 2]) + rng.uniform(-0.12, 0.12)
            step = rng.uniform(5, 9)
            shade = rng.choice([(132, 120, 70), (206, 192, 132)])
            for k in range(int(size / step) + 2):
                off = k * step + rng.uniform(-1, 1)
                for t in range(size * 2):
                    x = (math.cos(ang) * t * 0.5 - math.sin(ang) * off)
                    y = (math.sin(ang) * t * 0.5 + math.cos(ang) * off)
                    j = ((int(y) % size) * size + (int(x) % size)) * 4
                    px[j] = int(px[j] + (shade[0] - px[j]) * 0.10)
                    px[j + 1] = int(px[j + 1] + (shade[1] - px[j + 1]) * 0.10)
                    px[j + 2] = int(px[j + 2] + (shade[2] - px[j + 2]) * 0.10)

    if "canopy" in spec:
        count, dark, light, rmin, rmax = spec["canopy"]
        for _ in range(count):
            cx, cy = rng.random() * size, rng.random() * size
            r = rng.uniform(rmin, rmax)
            _blob(px, size, cx, cy + r * 0.35, r, dark, 0.55, 0.5)
            _blob(px, size, cx, cy, r * 0.86, light, 0.42, 0.6)

    for count, rgb, alpha, rmin, rmax in spec.get("grain", []):
        _speckle(px, size, rng, count, rgb, alpha, rmin, rmax)

    return bytes(px)
