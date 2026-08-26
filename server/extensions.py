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

        entry.update({
            "id": manifest.get("id") or name,
            "name": manifest.get("name") or name,
            "version": manifest.get("version", "0.0.0"),
            "author": manifest.get("author", ""),
            "description": manifest.get("description", ""),
            "main": manifest.get("main", "main.js"),
            "apiVersion": manifest.get("apiVersion", 1),
        })
        entry["enabled"] = entry["id"] not in disabled
        if not os.path.isfile(os.path.join(folder, entry["main"])):
            entry["error"] = "main file %r is missing" % entry["main"]
        out.append(entry)
    return out
