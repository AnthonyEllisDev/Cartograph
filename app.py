#!/usr/bin/env python3
"""Cartograph — a local map maker.

Runs entirely on your own machine. This script starts a small web server bound
to localhost, opens your browser at it, and serves the editor from the web/
folder. Your maps, your asset packs and your exports are ordinary folders next
to this file; nothing is uploaded anywhere and no network connection is needed
after the first launch.

    python app.py                 start it
    python app.py --port 7860     pin the port
    python app.py --no-browser    do not open a browser
    python app.py --regen-pack    re-roll the generated starter pack
"""

import argparse
import json
import os
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server.http import Context, serve                     # noqa: E402

APP_NAME = "Cartograph"
VERSION = "0.1.0"
CONFIG_PATH = os.path.join(ROOT, "config.json")
DEFAULT_CONFIG = {"port": 7870, "openBrowser": True, "verbose": False, "packSeed": "v1",
                  "tileSize": 256, "disabledExtensions": []}

BANNER = r"""
   ___          _                          _
  / __|__ _ _ _| |_ ___  __ _ _ _ __ _ _ __| |_
 | (__/ _` | '_|  _/ _ \/ _` | '_/ _` | '_ \ ' \
  \___\__,_|_|  \__\___/\__, |_| \__,_| .__/_||_|
                        |___/         |_|
"""


def load_config():
    config = dict(DEFAULT_CONFIG)
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8") as fh:
                config.update(json.load(fh))
        except (OSError, ValueError) as exc:
            print("  ! config.json ignored (%s)" % exc)
    return config


def save_config(config):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
            json.dump(config, fh, indent=1)
    except OSError:
        pass


def ensure_folders():
    for sub in ("projects", "exports", "extensions", os.path.join("assets", "packs", "user")):
        os.makedirs(os.path.join(ROOT, sub), exist_ok=True)


def ensure_starter_pack(config, force=False):
    """Bake the generated pack the first time the program is run."""
    pack_dir = os.path.join(ROOT, "assets", "packs", "starter")
    manifest = os.path.join(pack_dir, "pack.json")
    if os.path.isfile(manifest) and not force:
        return False
    from tools import genpack
    print("  Generating the starter asset pack (one time, ~10s)...")
    genpack.build(pack_dir, config.get("packSeed", "v1"), int(config.get("tileSize", 256)))
    return True


def main():
    ap = argparse.ArgumentParser(description="%s %s" % (APP_NAME, VERSION))
    ap.add_argument("--port", type=int, default=None, help="port to listen on (0 picks a free one)")
    ap.add_argument("--host", default="127.0.0.1", help="interface to bind (loopback by default)")
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    ap.add_argument("--regen-pack", action="store_true", help="rebuild the generated starter pack")
    ap.add_argument("--seed", default=None, help="seed for the generated pack")
    ap.add_argument("--verbose", action="store_true", help="log every request")
    args = ap.parse_args()

    config = load_config()
    if args.port is not None:
        config["port"] = args.port
    if args.seed:
        config["packSeed"] = args.seed
    if args.verbose:
        config["verbose"] = True

    print(BANNER)
    print("  %s %s" % (APP_NAME, VERSION))
    print("  Folder: %s" % ROOT)

    ensure_folders()
    ensure_starter_pack(config, force=args.regen_pack or bool(args.seed))

    ctx = Context(ROOT, APP_NAME, VERSION, config)
    ctx.save_config = lambda: save_config(config)
    port = config.get("port", 7870)
    try:
        httpd, port = serve(ctx, args.host, port)
    except OSError as exc:
        print("  ! port %s is busy (%s) — picking a free one" % (port, exc))
        httpd, port = serve(ctx, args.host, 0)
    config["port"] = port
    save_config(config)

    url = "http://%s:%d/" % ("127.0.0.1" if args.host == "0.0.0.0" else args.host, port)
    print("  Serving at %s" % url)
    print("  Maps in ./projects   assets in ./assets/packs   exports in ./exports")
    print("  Extensions in ./extensions")
    print("  Press Ctrl+C to stop.\n")

    if config.get("openBrowser", True) and not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(0.4), webbrowser.open(url)), daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopping.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
