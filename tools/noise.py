"""Seamless value noise, standard library only.

Everything the starter pack draws sits on this. The lattice wraps, so a tile
generated at any octave meets its own opposite edge exactly — which is the whole
requirement for a texture that will be repeated across a map.
"""

import math
import random


def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def value_noise(size, cells, rng):
    """A size x size field of 0..1 values from a cells x cells wrapping lattice."""
    grid = [[rng.random() for _ in range(cells)] for _ in range(cells)]
    step = size / cells
    out = [0.0] * (size * size)
    for y in range(size):
        gy = y / step
        y0 = int(gy) % cells
        y1 = (y0 + 1) % cells
        fy = _smooth(gy - int(gy))
        row0, row1 = grid[y0], grid[y1]
        base = y * size
        for x in range(size):
            gx = x / step
            x0 = int(gx) % cells
            x1 = (x0 + 1) % cells
            fx = _smooth(gx - int(gx))
            a = row0[x0] + (row0[x1] - row0[x0]) * fx
            b = row1[x0] + (row1[x1] - row1[x0]) * fx
            out[base + x] = a + (b - a) * fy
    return out


def fbm(size, cells, octaves, rng, gain=0.5, lacunarity=2):
    """Stacked octaves of value noise, normalised to 0..1."""
    total = [0.0] * (size * size)
    amp, norm, c = 1.0, 0.0, cells
    for _ in range(octaves):
        layer = value_noise(size, c, rng)
        for i in range(size * size):
            total[i] += layer[i] * amp
        norm += amp
        amp *= gain
        c *= lacunarity
        if c > size:
            break
    inv = 1.0 / norm
    return [v * inv for v in total]


def ridged(size, cells, octaves, rng):
    """Noise folded about its midpoint — the creased look that reads as rock."""
    f = fbm(size, cells, octaves, rng)
    return [1.0 - abs(v - 0.5) * 2.0 for v in f]


def warp(field, size, dx, dy, amount):
    """Push a field around by another pair of fields. Breaks up the lattice grid
    that otherwise shows through low-octave noise as faint square banding."""
    out = [0.0] * (size * size)
    for y in range(size):
        for x in range(size):
            i = y * size + x
            sx = int(x + (dx[i] - 0.5) * amount) % size
            sy = int(y + (dy[i] - 0.5) * amount) % size
            out[i] = field[sy * size + sx]
    return out


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def mix(a, b, t):
    return a + (b - a) * t


def mix_rgb(c1, c2, t):
    return (int(mix(c1[0], c2[0], t)), int(mix(c1[1], c2[1], t)), int(mix(c1[2], c2[2], t)))
