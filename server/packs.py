"""Asset packs: what the brushes and stamps are made of.

A pack is just a folder. If it has a pack.json we trust it; if it does not — the
usual case for a folder someone dropped their own textures into — we walk it and
build an index from the file names. That is the whole contract, so adding art to
this program never involves more than copying files in.
"""

import json
import os
import time

from server import png
from server.safe import Unsafe, slug, under

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
                manifest = json.load(fh)
        except (OSError, ValueError) as exc:
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
        pack = read_pack(pack_dir, name)
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
    stem = slug(os.path.splitext(os.path.basename(filename))[0], "filename")
    sub = "terrain" if kind == "terrain" else "stamps"
    dest_dir = under(packs_root, pack, sub)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, stem + ext)
    n = 1
    while os.path.exists(dest):
        n += 1
        dest = os.path.join(dest_dir, "%s-%d%s" % (stem, n, ext))
    with open(dest, "wb") as fh:
        fh.write(data)
    return {
        "id": "%s/%s" % (pack, os.path.splitext(os.path.basename(dest))[0]),
        "kind": kind, "label": _title(stem), "group": group,
        "file": "%s/%s" % (sub, os.path.basename(dest)),
        "imported": time.time(),
    }
