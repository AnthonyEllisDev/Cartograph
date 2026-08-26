"""Projects on disk.

A project is a folder, not an opaque file. project.json holds the map and every
brush stroke as data; layers/ holds a PNG only for layers that carry imported
pixels. You can read it, diff it in git, hand-edit it, or recover a map from a
half-broken save — none of which is true of a single binary blob.
"""

import json
import os
import shutil
import time

from server.safe import Unsafe, slug, slugify, under

FORMAT = 1


def _meta_path(root, name):
    return under(root, name, "project.json")


def list_projects(root):
    out = []
    if not os.path.isdir(root):
        return out
    for name in sorted(os.listdir(root)):
        folder = os.path.join(root, name)
        meta = os.path.join(folder, "project.json")
        if not os.path.isdir(folder) or not os.path.isfile(meta):
            continue
        try:
            with open(meta, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue
        out.append({
            "slug": name,
            "name": doc.get("name", name),
            "width": doc.get("width"),
            "height": doc.get("height"),
            "layers": len(doc.get("layers", [])),
            "modified": os.path.getmtime(meta),
            "thumb": os.path.isfile(os.path.join(folder, "thumb.png")),
        })
    out.sort(key=lambda p: p["modified"], reverse=True)
    return out


def read(root, name):
    with open(_meta_path(root, slug(name, "project")), encoding="utf-8") as fh:
        return json.load(fh)


def write(root, name, doc):
    name = slug(name, "project")
    folder = under(root, name)
    os.makedirs(os.path.join(folder, "layers"), exist_ok=True)
    doc["format"] = FORMAT
    doc["slug"] = name
    doc["modified"] = time.time()
    doc.setdefault("created", doc["modified"])
    # Write beside the target and rename, so a crash mid-save cannot leave a
    # project.json that is half a file.
    tmp = os.path.join(folder, "project.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp, os.path.join(folder, "project.json"))
    return doc


def write_blob(root, name, kind, blob_id, data):
    """Store a layer raster or the project thumbnail."""
    name = slug(name, "project")
    if kind == "thumb":
        path = under(root, name, "thumb.png")
    else:
        blob_id = slug(blob_id, "layer")
        path = under(root, name, "layers", blob_id + ".png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
    return os.path.relpath(path, root).replace(os.sep, "/")


def sweep_blobs(root, name, keep_ids):
    """Delete layer rasters no longer referenced by the saved document."""
    folder = under(root, slug(name, "project"), "layers")
    if not os.path.isdir(folder):
        return 0
    removed = 0
    keep = {i + ".png" for i in keep_ids}
    for fn in os.listdir(folder):
        if fn.endswith(".png") and fn not in keep:
            os.remove(os.path.join(folder, fn))
            removed += 1
    return removed


def delete(root, name):
    folder = under(root, slug(name, "project"))
    if not os.path.isdir(folder):
        raise Unsafe("no such project")
    shutil.rmtree(folder)


def unique_slug(root, title):
    base = slugify(title, "untitled")
    candidate = base
    n = 1
    while os.path.exists(os.path.join(root, candidate)):
        n += 1
        candidate = "%s %d" % (base, n)
    return candidate
