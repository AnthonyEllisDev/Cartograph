"""Backups: a copy of a map taken before the editor throws its changes away.

Opening another map, or starting a new one, discards whatever has not been
saved. The editor asks first, but a dialog is clicked through without being
read more often than anyone would like, so a copy of the map as it stood is
written here before the question is even put -- whatever the answer. The
Projects tab lists them and puts one back as a new map.

One file per backup in backups/, named by when it was taken and what the map
was called, so the folder sorts by time and a person can find one by hand.
The file holds the document verbatim beside a few lines saying what it was:
a map is already readable JSON, and a backup should be no harder to recover
without this program than the map itself would have been. The folder is never
served as static files; backups only reach the editor as JSON through the API.
"""

import json
import os
import tempfile
import time

from server import safe
from server.projects import MAX_DEPTH, _too_deep
from server.safe import Unsafe, slug, slugify, under

FORMAT = 1

# Enough to step back through a morning's worth of accidents, few enough that
# the folder never needs tidying by hand. The oldest go first.
KEEP = 20


def _check(doc):
    """The tests projects.read makes, so nothing is kept that will not open."""
    if not isinstance(doc, dict):
        raise ValueError("a backup needs the map as an object")
    layers = doc.get("layers")
    if not isinstance(layers, list) or not any(
            isinstance(l, dict) and isinstance(l.get("id"), str) and l["id"] for l in layers):
        raise ValueError("a backup needs a map with layers")
    if _too_deep(doc, MAX_DEPTH):
        raise ValueError("document is nested more than %d deep" % MAX_DEPTH)


def _summary(bid, record, path):
    doc = record.get("doc") if isinstance(record.get("doc"), dict) else {}
    layers = doc.get("layers")
    name = record.get("name")
    return {
        "id": bid,
        "name": name if isinstance(name, str) else bid,
        "reason": record.get("reason") if isinstance(record.get("reason"), str) else "",
        "slug": record.get("slug") if isinstance(record.get("slug"), str) else None,
        "saved": record.get("saved") if isinstance(record.get("saved"), (int, float)) else os.path.getmtime(path),
        "width": doc.get("width"),
        "height": doc.get("height"),
        "kind": doc.get("kind") if isinstance(doc.get("kind"), str) else None,
        "layers": len(layers) if isinstance(layers, list) else 0,
        "bytes": os.path.getsize(path),
    }


def _load(path):
    with open(path, encoding="utf-8") as fh:
        record = safe.load(fh)
    if not isinstance(record, dict):
        raise ValueError("not a backup")
    _check(record.get("doc"))
    return record


def list_backups(root):
    """Every backup that would open, newest first. One that will not -- cut
    short by a crash, or edited by hand into the wrong shape -- is skipped,
    never allowed to empty the list."""
    out = []
    if not os.path.isdir(root):
        return out
    for entry in os.listdir(root):
        stem, ext = os.path.splitext(entry)
        if ext.lower() != ".json":
            continue
        try:
            slug(stem, "backup")
            path = under(root, entry)
            out.append(_summary(stem, _load(path), path))
        except (OSError, ValueError, RecursionError, Unsafe):
            continue
    out.sort(key=lambda b: (b["saved"], b["id"]), reverse=True)
    return out


def _path(root, bid):
    return under(root, slug(bid, "backup") + ".json")


def read(root, bid):
    path = _path(root, bid)
    try:
        record = _load(path)
    except RecursionError:
        raise ValueError("backup is nested too deeply") from None
    return record["doc"]


def write(root, body):
    """Keep a copy of the map in `body["doc"]` and return its summary.

    Never overwrites: two backups in the same millisecond get a number, and
    the claim is an exclusive create, as an export's is."""
    if not isinstance(body, dict):
        raise ValueError("body must be an object")
    doc = body.get("doc")
    _check(doc)
    now = time.time()
    name = doc.get("name") if isinstance(doc.get("name"), str) else ""
    reason = body.get("reason") if isinstance(body.get("reason"), str) else ""
    record = {
        "backup": FORMAT,
        "name": name.strip()[:120] or "Untitled Map",
        "reason": reason.strip()[:200],
        "slug": doc.get("slug") if isinstance(doc.get("slug"), str) else None,
        "saved": now,
        "doc": doc,
    }
    text = json.dumps(record, separators=(",", ":"))
    os.makedirs(root, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + "-%03d" % int((now % 1) * 1000)
    # The id is a slug, so it has to fit SLUG_RE's 64 characters: 19 of
    # timestamp, a space, and as much of the name as is left.
    base = (stamp + " " + slugify(name, "map")[:40]).strip()
    fd, tmp = tempfile.mkstemp(dir=root, prefix=".backup-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        for n in range(1, 1000):
            bid = base if n == 1 else "%s %d" % (base[:60].rstrip(), n)
            dest = under(root, bid + ".json")
            try:
                os.link(tmp, dest)
            except FileExistsError:
                continue
            except OSError:
                # No hard links (FAT): an exclusive create and a copy.
                try:
                    out = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                except FileExistsError:
                    continue
                with open(tmp, "rb") as src, os.fdopen(out, "wb") as dst:
                    dst.write(src.read())
            summary = _summary(bid, record, dest)
            prune(root, keep_id=bid)
            return summary
        raise ValueError("could not find a free name for the backup")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def prune(root, keep=KEEP, keep_id=None):
    """Remove all but the newest `keep`. Only files that look like backups
    are counted or touched; anything else a person put in the folder stays.
    Never raises: the backup it follows has already been written."""
    try:
        listed = list_backups(root)
    except OSError:
        return
    for b in listed[keep:]:
        if b["id"] == keep_id:
            continue
        try:
            os.remove(_path(root, b["id"]))
        except (OSError, Unsafe):
            pass


def delete(root, bid):
    try:
        os.remove(_path(root, bid))
    except FileNotFoundError:
        raise Unsafe("no such backup: %r" % bid) from None
