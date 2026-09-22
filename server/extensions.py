"""Extensions.

An extension is a folder under extensions/ with an extension.json and a
JavaScript module. The server's whole job here is to say what is on disk and
remember which ones the user has switched off — the loading and the API live in
the browser, because that is where the editor is.
"""

import json
import os

MANIFEST = "extension.json"


def index(root, disabled=()):
    """Every extension folder, with its manifest read and validated."""
    out = []
    if not os.path.isdir(root):
        return out
    for name in sorted(os.listdir(root)):
        folder = os.path.join(root, name)
        if not os.path.isdir(folder) or name.startswith(".") or name.startswith("_"):
            continue
        entry = {"id": name, "dir": name, "name": name, "enabled": name not in disabled}
        path = os.path.join(folder, MANIFEST)
        if not os.path.isfile(path):
            entry["error"] = "no extension.json"
            out.append(entry)
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                manifest = json.load(fh)
        except (OSError, ValueError) as exc:
            entry["error"] = "extension.json: %s" % exc
            out.append(entry)
            continue

        # Same reasoning as read_pack: one manifest of the wrong shape must not
        # empty the whole extensions list.
        if not isinstance(manifest, dict):
            entry["error"] = "extension.json: expected an object"
            out.append(entry)
            continue

        entry.update({
            "id": manifest.get("id") or name,
            "name": manifest.get("name") or name,
            "version": manifest.get("version", "0.0.0"),
            "author": manifest.get("author", ""),
            "description": manifest.get("description", ""),
            "main": manifest.get("main", "main.js"),
            "apiVersion": manifest.get("apiVersion", 1),
        })
        # A manifest id of the wrong type used to raise straight out of index()
        # and empty the whole Extensions tab over one bad file.
        if not isinstance(entry.get("id"), str):
            entry["id"] = name
            entry["error"] = entry.get("error") or "id must be text"
        entry["enabled"] = entry["id"] not in disabled
        # An absolute "main" makes os.path.join throw the folder away, so the
        # file it checked for was never the one the browser would ask for.
        if not isinstance(entry["main"], str) or os.path.isabs(entry["main"]) \
                or entry["main"] != os.path.normpath(entry["main"]).replace(os.sep, "/") \
                or entry["main"].startswith(".."):
            entry["error"] = "main %r must be a relative path inside the extension" % entry["main"]
        elif not os.path.isfile(os.path.join(folder, entry["main"])):
            entry["error"] = "main file %r is missing" % entry["main"]
        out.append(entry)
    return out
