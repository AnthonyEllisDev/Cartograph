"""Bulk-import a folder of images as an asset pack.

The Assets tab in the program does the same job for a handful of files. This is
for the case where you have just unzipped four hundred of them.

    python tools/import_folder.py ~/Downloads/coastal-pack --name "Coastal" \
        --license CC0-1.0 --kind stamp --group coast

Files are copied, never moved, and the source folder is left alone.
"""

import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server import packs                      # noqa: E402
from server.safe import slugify               # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Import a folder of images as an asset pack")
    ap.add_argument("source", help="folder of images to copy in")
    ap.add_argument("--name", default=None, help="pack name (defaults to the folder name)")
    ap.add_argument("--license", default="unknown", help="licence to record in pack.json")
    ap.add_argument("--author", default="", help="who made the art")
    ap.add_argument("--kind", choices=["stamp", "terrain"], default="stamp",
                    help="how these should be used (default: stamp)")
    ap.add_argument("--group", default=None, help="group name in the picker")
    args = ap.parse_args()

    if not os.path.isdir(args.source):
        raise SystemExit("not a folder: %s" % args.source)

    name = args.name or os.path.basename(os.path.abspath(args.source))
    pack_id = slugify(name, "imported")
    dest = os.path.join(ROOT, "assets", "packs", pack_id)
    sub = "terrain" if args.kind == "terrain" else "stamps"
    os.makedirs(os.path.join(dest, sub), exist_ok=True)

    copied = 0
    for root, dirs, files in os.walk(args.source):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fn in sorted(files):
            if os.path.splitext(fn)[1].lower() not in packs.IMAGE_EXT:
                continue
            rel = os.path.relpath(root, args.source)
            group = args.group or (rel.replace(os.sep, "-").lower() if rel != "." else "imported")
            target_dir = os.path.join(dest, sub, group)
            os.makedirs(target_dir, exist_ok=True)
            shutil.copy2(os.path.join(root, fn), os.path.join(target_dir, fn))
            copied += 1

    manifest = {
        "id": pack_id, "name": name, "author": args.author, "license": args.license,
        "assets": packs._walk_loose(dest, pack_id),          # noqa: SLF001 - same package
    }
    for asset in manifest["assets"]:
        asset["kind"] = args.kind
    with open(os.path.join(dest, "pack.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)

    print("Copied %d files into assets/packs/%s" % (copied, pack_id))
    print("Indexed %d assets as %s, licence %s" % (len(manifest["assets"]), args.kind, args.license))
    print("Press 'Rescan folder' on the Assets tab, or restart the program.")


if __name__ == "__main__":
    main()
