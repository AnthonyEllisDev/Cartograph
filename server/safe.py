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
    try:
        target = os.path.realpath(os.path.join(root, *parts))
    except ValueError:
        # A NUL byte in a static path reaches realpath, which raises ValueError
        # rather than anything the callers catch -- so the handler died without
        # writing a single byte of response.
        raise Unsafe("bad path: %r" % (os.path.join(*parts) if parts else "",))
    if target != root and not target.startswith(root + os.sep):
        raise Unsafe("path escapes %s: %r" % (root, os.path.join(*parts)))
    return target


def slugify(text, fallback="untitled"):
    """Turn a human title into something safe to use as a folder name.

    The trim has to happen *before* the check, not after it. SLUG_RE caps the
    whole string at 64 characters, so testing the untrimmed text meant every
    title longer than that failed the match and fell back -- one long map name
    saved to projects/untitled, the next to projects/untitled 2, and the
    folder names carried none of what the user had typed.
    """
    if not isinstance(text, str):
        # This is the front door for untrusted text, so it takes whatever the
        # request body held rather than raising on a number or a list.
        text = ""
    text = re.sub(r"[^A-Za-z0-9 _-]+", "", text.strip())
    text = re.sub(r"\s+", " ", text).strip()[:64].strip()
    return text if SLUG_RE.match(text or "") else fallback
