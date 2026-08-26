"""Bake the starter asset pack.

Run once on first launch, or by hand to re-roll the pack from a different seed:

    python tools/genpack.py --seed harbour --size 256

Terrain comes out as seamless PNG tiles; symbols come out as SVG, so they stay
sharp at print resolution and can be opened in any editor.
"""

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server.png import encode          # noqa: E402
from tools import stamps, terrain      # noqa: E402

PACK_ID = "starter"


def build(out_dir, seed="v1", size=256, log=print):
    terr_dir = os.path.join(out_dir, "terrain")
    stamp_dir = os.path.join(out_dir, "stamps")
    os.makedirs(terr_dir, exist_ok=True)
    os.makedirs(stamp_dir, exist_ok=True)

    assets = []
    started = time.time()
    names = list(terrain.TERRAINS)
    for i, name in enumerate(names, 1):
        spec = terrain.TERRAINS[name]
        path = os.path.join(terr_dir, name + ".png")
        with open(path, "wb") as fh:
            fh.write(encode(size, size, terrain.render(name, size, seed)))
        assets.append({
            "id": "%s/%s" % (PACK_ID, name), "kind": "terrain", "label": spec["label"],
            "group": spec["group"], "file": "terrain/%s.png" % name,
            "width": size, "height": size, "tileable": True,
        })
        log("  terrain %2d/%d  %s" % (i, len(names), name))

    for sid, label, group, variant, svg in stamps.build(seed):
        path = os.path.join(stamp_dir, sid + ".svg")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(svg)
        assets.append({
            "id": "%s/%s" % (PACK_ID, sid), "kind": "stamp", "label": label,
            "group": group, "file": "stamps/%s.svg" % sid, "variant": variant,
        })

    manifest = {
        "id": PACK_ID,
        "name": "Starter Pack",
        "author": "generated",
        "license": "CC0-1.0",
        "generated": True,
        "seed": seed,
        "tileSize": size,
        "assets": assets,
    }
    with open(os.path.join(out_dir, "pack.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    log("  %d assets in %.1fs" % (len(assets), time.time() - started))
    return manifest


def main():
    ap = argparse.ArgumentParser(description="Generate the starter asset pack")
    ap.add_argument("--seed", default="v1")
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--out", default=os.path.join(ROOT, "assets", "packs", PACK_ID))
    args = ap.parse_args()
    print("Generating starter pack -> %s" % args.out)
    build(args.out, args.seed, args.size)


if __name__ == "__main__":
    main()
