"""The JSON API the editor talks to.

Every handler takes the request object built by server.http and returns
(status, content_type, bytes). Nothing here reaches outside the four data
folders — see server.safe for why that is enforced rather than assumed.
"""

import json
import os
import subprocess
import sys
import time

from server import extensions, packs, projects
from server.safe import Unsafe, slug


def _json(obj, status=200):
    return status, "application/json; charset=utf-8", json.dumps(obj).encode("utf-8")


def _err(message, status=400):
    return _json({"ok": False, "error": str(message)}, status)


def _disabled(ctx):
    """The set of switched-off extensions, from a config file anyone can edit.

    `or []` only covers a falsy value. A number there raised "not iterable" out
    of both extension endpoints at once, which empties the Extensions tab and
    leaves no way to put it right from inside the program; a bare string was
    worse, exploding into its own characters and being written back that way.
    """
    raw = ctx.config.get("disabledExtensions")
    if not isinstance(raw, list):
        return set()
    return {name for name in raw if isinstance(name, str)}


def _reveal(path):
    """Open a folder in the desktop's own file manager."""
    if sys.platform == "win32":
        os.startfile(path)                              # noqa: S606 - a folder we own
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])                # noqa: S603,S607
    else:
        subprocess.Popen(["xdg-open", path])            # noqa: S603,S607


def route(req):
    """Dispatch one API request. Returns None if the path is not ours."""
    path, method = req.path, req.method
    ctx = req.ctx

    if path == "/api/state" and method == "GET":
        return _json({
            "ok": True,
            "app": ctx.app_name,
            "version": ctx.version,
            "root": ctx.root,
            "folders": {
                "projects": ctx.projects_dir,
                "packs": ctx.packs_dir,
                "exports": ctx.exports_dir,
            },
            "config": ctx.config,
            "started": ctx.started,
        })

    if path == "/api/extensions" and method == "GET":
        return _json({"ok": True, "extensions": extensions.index(ctx.extensions_dir, _disabled(ctx))})

    if path.startswith("/api/extensions/") and method == "POST":
        try:
            name = slug(path[len("/api/extensions/"):], "extension")
        except Unsafe as exc:
            return _err(exc)
        body = json.loads(req.body or b"{}")
        disabled = _disabled(ctx)
        if isinstance(body, dict) and body.get("enabled"):
            disabled.discard(name)
        else:
            disabled.add(name)
        ctx.config["disabledExtensions"] = sorted(disabled)
        ctx.save_config()
        return _json({"ok": True, "disabled": ctx.config["disabledExtensions"]})

    if path == "/api/open-folder" and method == "POST":
        # A local program should be able to show you its own folders. Only the
        # four it owns, and only ever a folder.
        body = json.loads(req.body or b"{}")
        which = body.get("which") if isinstance(body, dict) else None
        # Only a string can name one of the four. A list or an object reached
        # the dict lookup below and raised "unhashable type" as a 500, where
        # the 400 four lines down is the right answer.
        if not isinstance(which, str):
            return _err("unknown folder")
        target = {
            "packs": ctx.packs_dir, "projects": ctx.projects_dir,
            "exports": ctx.exports_dir, "extensions": ctx.extensions_dir,
            "root": ctx.root,
        }.get(which)
        if not target:
            return _err("unknown folder")
        try:
            _reveal(target)
        except Exception as exc:                        # noqa: BLE001 - report, do not crash
            return _err("could not open the folder: %s" % exc)
        return _json({"ok": True, "path": target})

    if path == "/api/packs" and method == "GET":
        return _json({"ok": True, "packs": packs.index(ctx.packs_dir)})

    if path == "/api/packs/import" and method == "PUT":
        name = req.query.get("name", ["asset.png"])[0]
        kind = req.query.get("kind", ["stamp"])[0]
        group = req.query.get("group", ["imported"])[0]
        pack = req.query.get("pack", ["user"])[0]
        try:
            entry = packs.import_asset(ctx.packs_dir, name, req.body, kind, group, pack)
        except Unsafe as exc:
            return _err(exc)
        return _json({"ok": True, "asset": entry, "pack": pack})

    if path == "/api/projects" and method == "GET":
        return _json({"ok": True, "projects": projects.list_projects(ctx.projects_dir)})

    if path == "/api/projects" and method == "POST":
        doc = json.loads(req.body or b"{}")
        name = projects.unique_slug(ctx.projects_dir, doc.get("name") or "Untitled Map")
        doc["name"] = doc.get("name") or name
        saved = projects.write(ctx.projects_dir, name, doc)
        return _json({"ok": True, "project": saved})

    if path.startswith("/api/projects/"):
        rest = path[len("/api/projects/"):]
        parts = [p for p in rest.split("/") if p]
        if not parts:
            return _err("missing project name", 404)
        try:
            name = slug(parts[0], "project")
        except Unsafe as exc:
            return _err(exc)

        if len(parts) == 1 and method == "GET":
            try:
                return _json({"ok": True, "project": projects.read(ctx.projects_dir, name)})
            except (OSError, ValueError) as exc:
                return _err("cannot read project: %s" % exc, 404)

        if len(parts) == 1 and method == "PUT":
            doc = json.loads(req.body or b"{}")
            try:
                saved = projects.write(ctx.projects_dir, name, doc)
            except ValueError as exc:
                return _err(exc)
            # Every layer still in the document keeps its blob. The old test
            # was `l.get("raster")`, a property no layer has ever had -- raster
            # is a layer *kind* -- so the list was always empty and the sweep
            # deleted every imported-pixel layer on every save, autosave
            # included.
            # ...and the shapes are checked, not assumed: the save at the
            # line above has already landed on disk, so anything raising here
            # reports a failure for a save that succeeded and leaves the
            # document dirty for good. "layers": null defeats the .get default.
            layers = doc.get("layers")
            keep = [l["id"] for l in (layers if isinstance(layers, list) else [])
                    if isinstance(l, dict) and isinstance(l.get("id"), str)]
            projects.sweep_blobs(ctx.projects_dir, name, keep)
            return _json({"ok": True, "project": saved})

        if len(parts) == 1 and method == "DELETE":
            try:
                projects.delete(ctx.projects_dir, name)
            except Unsafe as exc:
                return _err(exc, 404)
            return _json({"ok": True})

        if len(parts) == 2 and parts[1] == "thumb" and method == "PUT":
            try:
                projects.write_blob(ctx.projects_dir, name, "thumb", None, req.body)
            except Unsafe as exc:
                return _err(exc, 404)
            return _json({"ok": True})

        if len(parts) == 3 and parts[1] == "layer" and method == "PUT":
            try:
                rel = projects.write_blob(ctx.projects_dir, name, "layer", parts[2], req.body)
            except Unsafe as exc:
                return _err(exc)
            return _json({"ok": True, "path": rel, "bytes": len(req.body)})

        return _err("no such endpoint", 404)

    if path == "/api/export" and method == "PUT":
        raw = req.query.get("name", ["map.png"])[0]
        stem = os.path.splitext(os.path.basename(raw))[0][:64] or "map"
        stem = "".join(c for c in stem if c.isalnum() or c in " _-").strip() or "map"
        # Maps go out as pictures; battle maps also go out as data for a
        # virtual tabletop, which is a JSON file with the walls in it.
        ext = ".png"
        for allowed in (".png", ".jpg", ".jpeg", ".webp", ".dd2vtt", ".uvtt", ".json"):
            if raw.lower().endswith(allowed):
                ext = allowed
                break
        os.makedirs(ctx.exports_dir, exist_ok=True)
        # Claiming the name and opening it have to be one step. This server
        # serves each request on its own thread, so two exports racing for
        # "map.png" both saw it free and one of them lost its bytes.
        dest = os.path.join(ctx.exports_dir, stem + ext)
        n = 1
        while True:
            try:
                fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            except FileExistsError:
                n += 1
                dest = os.path.join(ctx.exports_dir, "%s-%d%s" % (stem, n, ext))
                continue
            with os.fdopen(fd, "wb") as fh:
                fh.write(req.body)
            break
        return _json({"ok": True, "path": dest, "bytes": len(req.body)})

    if path == "/api/shutdown" and method == "POST":
        ctx.stop()
        return _json({"ok": True, "stopping": True})

    if path.startswith("/api/"):
        return _err("no such endpoint", 404)
    return None
