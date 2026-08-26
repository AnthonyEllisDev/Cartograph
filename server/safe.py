"""Path sandboxing.

Everything the browser can name — a project slug, a pack id, an asset file —
arrives as a string from a page that anyone could have opened. These helpers are
the single place that turns such a string into a real path, and they refuse
anything that would land outside the folder it belongs in.
"""

import os
import re

SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$")


class Unsafe(Exception):
    """Raised when a client-supplied name would escape its folder."""


def slug(name, what="name"):
    """Validate a single path component (no separators, no dot-dot)."""
    if not isinstance(name, str) or not SLUG_RE.match(name):
        raise Unsafe("bad %s: %r" % (what, name))
    if name in (".", "..") or name.strip() != name:
        raise Unsafe("bad %s: %r" % (what, name))
    return name


def under(root, *parts):
    """Join parts onto root and prove the result is still inside root."""
    root = os.path.realpath(root)
    target = os.path.realpath(os.path.join(root, *parts))
    if target != root and not target.startswith(root + os.sep):
        raise Unsafe("path escapes %s: %r" % (root, os.path.join(*parts)))
    return target


def slugify(text, fallback="untitled"):
    """Turn a human title into something safe to use as a folder name."""
    text = (text or "").strip()
    text = re.sub(r"[^A-Za-z0-9 _-]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:64] if SLUG_RE.match(text or "") else fallback
