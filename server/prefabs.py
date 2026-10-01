"""Prefabs on disk.

A prefab is a set of things lifted off one map to be put down on another: a
furnished room, a gatehouse with its doors and torches, a signpost with its
label. It is what the Select tool's clipboard holds, written out as one
readable JSON file in prefabs/ beside the program, so it outlives the session,
can be copied to a friend, and can be read and hand-edited like a map.

Every file here may have been written by someone else, so nothing is trusted
on the way in: the name goes through safe.slugify, the file through safe.load,
and the shape is checked entry by entry -- a prefab the editor cannot place is
left out of the list rather than handed over to fail half way through a paste.
"""

import json
import math
import os
import tempfile
import time

from server import safe
from server.projects import MAX_DEPTH, _too_deep
from server.safe import Unsafe, slug, slugify, under

FORMAT = 1

# The layer kinds whose ops are self-contained objects -- the clipboard's list.
# A paint stroke exists only as pixels on its layer and cannot be carried.
KINDS = ("objects", "labels", "paths", "regions", "walls", "lights", "notes")

# A prefab is a handful of things. A file far past this is not one the editor
# wrote, and reading it into every list request would make the panel crawl.
MAX_BYTES = 2 * 1024 * 1024
MAX_ENTRIES = 2000


def _number(value):
    # bool is an int in Python, and True is not a coordinate.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _point(value):
    return isinstance(value, dict) and _number(value.get("x")) and _number(value.get("y"))


def _entry_ok(entry):
    """Can the editor place this op? It moves an op by its x/y or by every
    point in `points`, so one of the two must be there and be numbers."""
    if not isinstance(entry, dict):
        return False
    pts = entry.get("points")
    if pts is not None:
        if not isinstance(pts, list) or not pts or not all(_point(p) for p in pts):
            return False
    if "x" in entry or "y" in entry:
        if not _point(entry):
            return False
    return pts is not None or _point(entry)


def check(body):
    """Return (entries, kinds) from a request body or a file, or raise
    ValueError saying what is wrong with it."""
    if not isinstance(body, dict):
        raise ValueError("a prefab must be an object")
    entries, kinds = body.get("entries"), body.get("kinds")
    if not isinstance(entries, list) or not isinstance(kinds, list) or len(entries) != len(kinds):
        raise ValueError("a prefab needs matching entries and kinds lists")
    if not entries:
        raise ValueError("a prefab needs at least one thing in it")
    if len(entries) > MAX_ENTRIES:
        raise ValueError("a prefab holds at most %d things" % MAX_ENTRIES)
    for kind, entry in zip(kinds, entries):
        if kind not in KINDS:
            raise ValueError("a prefab cannot carry a %r" % (kind,))
        if not _entry_ok(entry):
            raise ValueError("a prefab entry has no position")
    if _too_deep(body, MAX_DEPTH):
        raise ValueError("a prefab is nested too deeply")
    return entries, kinds


def _summary(name, doc, path):
    entries, kinds = check(doc)
    cell = doc.get("cell")
    return {
        "slug": name,
        "name": doc.get("name") if isinstance(doc.get("name"), str) and doc.get("name") else name,
        "entries": entries,
        "kinds": kinds,
        "cell": cell if _number(cell) and cell > 0 else None,
        "mapKind": doc.get("mapKind") if isinstance(doc.get("mapKind"), str) else None,
        "modified": os.path.getmtime(path),
    }


def list_prefabs(root):
    """Every prefab the editor could place, newest first. One unreadable or
    wrongly shaped file is skipped, never allowed to empty the list."""
    out = []
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return out
    for fname in names:
        stem, ext = os.path.splitext(fname)
        if ext.lower() != ".json":
            continue
        try:
            name = slug(stem, "prefab")
            path = under(root, fname)
            if not os.path.isfile(path) or os.path.getsize(path) > MAX_BYTES:
                continue
            with open(path, encoding="utf-8") as fh:
                doc = safe.load(fh)
            out.append(_summary(name, doc, path))
        except (Unsafe, OSError, ValueError, RecursionError):
            continue
    out.sort(key=lambda p: p["modified"], reverse=True)
    return out


def _unique(root, wanted):
    """A free file name for `wanted`, as projects get: "Guard post", then
    "Guard post 2". The claim itself is the O_EXCL in write(), not this."""
    base = slugify(wanted, "prefab")
    n = 1
    while True:
        name = base if n == 1 else ("%s %d" % (base[:58].rstrip(), n))
        if not os.path.exists(under(root, name + ".json")):
            return name
        n += 1


def write(root, body):
    """Save a new prefab and return its summary. Never overwrites: a second
    prefab with the same name gets a number, as a second map does."""
    entries, kinds = check(body)
    title = body.get("name") if isinstance(body.get("name"), str) else ""
    title = title.strip()[:120] or "Prefab"
    cell = body.get("cell")
    doc = {
        "format": FORMAT,
        "name": title,
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "cell": cell if _number(cell) and cell > 0 else None,
        "mapKind": body.get("mapKind") if isinstance(body.get("mapKind"), str) else None,
        "kinds": kinds,
        "entries": entries,
    }
    text = json.dumps(doc, indent=1)
    # Refused here rather than written and then never listed: list_prefabs
    # skips anything past MAX_BYTES, and a file that is saved but can never
    # be seen is worse than being told.
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("a prefab is limited to %d MB" % (MAX_BYTES // (1024 * 1024)))
    os.makedirs(root, exist_ok=True)
    # Claim the name and fill it as two steps that cannot interleave with
    # another save: write a private temp file, then link it into place with
    # O_EXCL semantics (os.link fails if the target exists). A second save
    # racing for "Guard post" moves on to "Guard post 2" instead of losing.
    fd, tmp = tempfile.mkstemp(dir=root, prefix=".prefab-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        for _ in range(1000):
            name = _unique(root, title)
            dest = under(root, name + ".json")
            try:
                os.link(tmp, dest)
            except FileExistsError:
                continue
            except OSError:
                # Some file systems (FAT on a stick) have no hard links. Fall
                # back to exclusive create and a copy of the bytes.
                try:
                    out = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                except FileExistsError:
                    continue
                with open(tmp, "rb") as src, os.fdopen(out, "wb") as dst:
                    dst.write(src.read())
            return _summary(name, doc, dest)
        raise ValueError("could not find a free name for the prefab")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def delete(root, name):
    # Found by the rule the list uses, extension in any case: "Hall.JSON",
    # dropped in by hand, was listed and then refused as no such prefab.
    wanted = slug(name, "prefab")
    fname = wanted + ".json"
    try:
        for entry in os.listdir(root):
            stem, ext = os.path.splitext(entry)
            if stem == wanted and ext.lower() == ".json":
                fname = entry
                break
    except OSError:
        pass
    path = under(root, fname)
    try:
        os.remove(path)
    except FileNotFoundError:
        raise Unsafe("no such prefab: %r" % name) from None
    except OSError:
        # A folder named like a prefab is not one, and was a 500.
        raise Unsafe("not a prefab file: %r" % name) from None
