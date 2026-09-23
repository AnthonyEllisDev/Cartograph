"""A PNG writer in about eighty lines of standard library.

The whole program has to run with nothing but a Python install — no Pillow, no
pip, no download step — and it still has to be able to bake its own texture pack
on first launch. zlib and struct are in the standard library, and a PNG is not a
complicated container, so this is all it takes.
"""

import struct
import zlib

_SIG = b"\x89PNG\r\n\x1a\n"


def _chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def encode(width, height, rgba, level=6):
    """RGBA bytes (4 per pixel, top row first) -> PNG file bytes."""
    if len(rgba) != width * height * 4:
        raise ValueError("expected %d bytes, got %d" % (width * height * 4, len(rgba)))
    stride = width * 4
    # Filter type 0 (None) in front of every scanline. Real encoders pick a
    # filter per row; for generated tiles the extra compression is not worth the
    # code, and zlib still does most of the work.
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    out = bytearray(_SIG)
    out += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    out += _chunk(b"IDAT", zlib.compress(bytes(raw), level))
    out += _chunk(b"IEND", b"")
    return bytes(out)


def dimensions(path):
    """Read width and height out of a PNG's IHDR without decoding the image.

    Returns None rather than raising for anything unreadable. The caller is
    indexing a folder the user dropped art into, where a broken symlink, a
    file with no read permission or a cloud placeholder is an ordinary thing
    to meet -- and one of those must not be able to empty the whole library.
    """
    try:
        with open(path, "rb") as fh:
            head = fh.read(33)
    except OSError:
        return None
    if len(head) < 24 or head[:8] != _SIG or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])
