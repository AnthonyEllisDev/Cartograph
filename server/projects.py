"""Projects on disk.

A project is a folder, not an opaque file. project.json holds the map and every
brush stroke as data; layers/ holds a PNG only for layers that carry imported
pixels. You can read it, diff it in git, hand-edit it, or recover a map from a
half-broken save — none of which is true of a single binary blob.
"""

import json
import os
import shutil
import tempfile
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
            # Valid JSON of the wrong shape parses cleanly and then raises on
            # first use, and a folder can go between the listdir and the stat.
            if not isinstance(doc, dict):
                continue
            layers = doc.get("layers")
            out.append({
                "slug": name,
                "name": doc.get("name", name),
                "width": doc.get("width"),
                "height": doc.get("height"),
                "layers": len(layers) if isinstance(layers, list) else 0,
                "modified": os.path.getmtime(meta),
                "thumb": os.path.isfile(os.path.join(folder, "thumb.png")),
            })
        except (OSError, ValueError):
            continue
    out.sort(key=lambda p: p["modified"], reverse=True)
    return out


def read(root, name):
    with open(_meta_path(root, slug(name, "project")), encoding="utf-8") as fh:
        doc = json.load(fh)
    # list_projects already refuses valid JSON of the wrong shape; read did
    # not, so a hand-edited map reached openDocument and threw outside any try
    # -- the editor came up half-initialised with nothing said about why. A
    # ValueError here is what the caller's 404 path already catches.
    if not isinstance(doc, dict):
        raise ValueError("project.json is not an object")
    if not isinstance(doc.get("layers"), list) or not doc["layers"]:
        raise ValueError("project.json has no layers")
    doc["layers"] = [l for l in doc["layers"] if isinstance(l, dict) and l.get("id")]
    if not doc["layers"]:
        raise ValueError("project.json has no usable layers")
    return doc


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
    # The temp name is unique per write, not per project: this server answers
    # each request on its own thread, and a manual save landing during an
    # in-flight autosave had both of them writing the one "project.json.tmp".
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".project-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        os.replace(tmp, os.path.join(folder, "project.json"))
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
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
        # slugify already trimmed to the 64 characters slug() allows, so the
        # counter has to come out of that budget rather than be added to it --
        # otherwise saving a long-named map is refused by our own validator.
        suffix = " %d" % n
        candidate = base[:64 - len(suffix)].strip() + suffix
    return candidate
