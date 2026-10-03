"""Asset packs: what the brushes and stamps are made of.

A pack is just a folder. If it has a pack.json we trust it; if it does not — the
usual case for a folder someone dropped their own textures into — we walk it and
build an index from the file names. That is the whole contract, so adding art to
this program never involves more than copying files in.
"""

import os
import time

from server import png, safe
from server.safe import Unsafe, slug, slugify, under

IMAGE_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
             ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif"}

# Folder names we recognise inside a loose pack, mapped to how the editor uses them.
KIND_DIRS = {
    "terrain": "terrain", "terrains": "terrain", "textures": "terrain",
    "tiles": "terrain", "materials": "terrain",
    "stamps": "stamp", "objects": "stamp", "symbols": "stamp",
    "props": "stamp", "icons": "stamp",
}


def _title(name):
    return " ".join(w.capitalize() for w in name.replace("_", " ").replace("-", " ").split())


def _walk_loose(pack_dir, pack_id):
    """Index a folder that has no manifest of its own."""
    assets = []
    for root, dirs, files in os.walk(pack_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        rel_root = os.path.relpath(root, pack_dir)
        parts = [] if rel_root == "." else rel_root.split(os.sep)
        kind = "stamp"
        group = "imported"
        for part in parts:
            if part.lower() in KIND_DIRS:
                kind = KIND_DIRS[part.lower()]
            else:
                group = part.lower()
        for fn in sorted(files):
            ext = os.path.splitext(fn)[1].lower()
            if ext not in IMAGE_EXT:
                continue
            rel = os.path.relpath(os.path.join(root, fn), pack_dir).replace(os.sep, "/")
            stem = os.path.splitext(fn)[0]
            entry = {
                "id": "%s/%s" % (pack_id, stem), "kind": kind, "label": _title(stem),
                "group": group, "file": rel,
            }
            if ext == ".png":
                dims = png.dimensions(os.path.join(root, fn))
                if dims:
                    entry["width"], entry["height"] = dims
                    # a square power-of-two image is almost always meant to tile
                    entry["tileable"] = (kind == "terrain")
            assets.append(entry)
    return assets


def read_pack(pack_dir, pack_id):
    manifest_path = os.path.join(pack_dir, "pack.json")
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, encoding="utf-8") as fh:
                manifest = safe.load(fh)
        except (OSError, ValueError, RecursionError) as exc:
            return {"id": pack_id, "name": pack_id, "error": "pack.json: %s" % exc, "assets": []}
        # Valid JSON is not the same as the right shape. A pack.json holding a
        # bare list parses cleanly and then takes the whole /api/packs call
        # down with an AttributeError, so every other pack on disk disappears
        # because of one bad file.
        if not isinstance(manifest, dict):
            return {"id": pack_id, "name": pack_id,
                    "error": "pack.json: expected an object", "assets": []}
        manifest.setdefault("id", pack_id)
        manifest.setdefault("name", pack_id)
        manifest.setdefault("assets", [])
        if not isinstance(manifest["assets"], list):
            manifest["assets"] = []
            manifest["error"] = "pack.json: assets is not a list"
        # ids in a hand-written manifest may be bare; namespace them
        for a in manifest["assets"]:
            if not isinstance(a, dict):
                continue
            ident = a.get("id")
            if not isinstance(ident, str):
                # A number or a list here used to reach `"/" not in <int>` and
                # take the whole library down. Treat it as absent instead; the
                # file name is a perfectly good name for the asset.
                ident = ""
                a.pop("id", None)
            if "/" not in ident:
                a["id"] = "%s/%s" % (manifest["id"], a.get("id") or a.get("file", "asset"))
        manifest["assets"] = [a for a in manifest["assets"] if isinstance(a, dict)]
        return manifest
    return {"id": pack_id, "name": _title(pack_id), "license": "unknown",
            "assets": _walk_loose(pack_dir, pack_id)}


def index(packs_root):
    """Every pack on disk, newest-changed first within a stable order."""
    out = []
    if not os.path.isdir(packs_root):
        return out
    for name in sorted(os.listdir(packs_root)):
        pack_dir = os.path.join(packs_root, name)
        if not os.path.isdir(pack_dir) or name.startswith("."):
            continue
        # One bad pack reports itself as broken; it does not take the other
        # packs with it. The library is read during boot, so an exception here
        # stops the editor coming up at all.
        try:
            pack = read_pack(pack_dir, name)
        except Exception as err:
            pack = {"id": name, "name": _title(name), "license": "unknown",
                    "assets": [], "error": str(err)}
        pack["dir"] = name
        pack["count"] = len(pack.get("assets", []))
        out.append(pack)
    return out


def import_asset(packs_root, filename, data, kind="stamp", group="imported", pack="user"):
    """Write one uploaded file into a pack and return its index entry."""
    pack = slug(pack, "pack")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in IMAGE_EXT:
        raise Unsafe("unsupported file type: %s" % ext)
    if kind not in ("terrain", "stamp"):
        kind = "stamp"
    # slugify, not slug: a file name is something to tidy, not a thing to
    # refuse. "tree (1).png" is how every browser names a second download of
    # the same file, and it was a 400 "bad filename" from the Assets tab.
    stem = slugify(os.path.splitext(os.path.basename(filename))[0], "asset")
    sub = "terrain" if kind == "terrain" else "stamps"
    dest_dir = under(packs_root, pack, sub)
    os.makedirs(dest_dir, exist_ok=True)
    # Claimed with O_EXCL rather than exists-then-open: exists() is False for a
    # dangling link, and open() would then follow it out of the pack. A pack
    # copied in from somewhere else is other people's files. O_EXCL refuses
    # any existing name, link or not, and closes the race between two uploads.
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    n = 1
    while True:
        name = stem + ext if n == 1 else "%s-%d%s" % (stem, n, ext)
        dest = os.path.join(dest_dir, name)
        try:
            fd = os.open(dest, flags, 0o644)
            break
        except FileExistsError:
            n += 1
            if n > 10000:
                raise Unsafe("too many files named %s" % stem)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return {
        "id": "%s/%s" % (pack, os.path.splitext(os.path.basename(dest))[0]),
        "kind": kind, "label": _title(stem), "group": group,
        "file": "%s/%s" % (sub, os.path.basename(dest)),
        "imported": time.time(),
    }
