"""The local web server.

Nothing here talks to the network beyond the loopback interface, and it says so
by binding to 127.0.0.1 rather than 0.0.0.0. Two guards matter on a machine
where the browser may have other pages open at the same time: requests carrying
an Origin that is not this server are refused, so a page on some other site
cannot quietly drive the file API; and every path a request names is resolved
through server.safe before it touches the disk.
"""

import json
import mimetypes
import os
import posixpath
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse, parse_qs

from server import api
from server.safe import Unsafe, under

MAX_BODY = 192 * 1024 * 1024        # a 8k x 8k layer PNG with room to spare

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/json", ".json")


class Request(object):
    __slots__ = ("ctx", "method", "path", "query", "body", "headers")


class Context(object):
    """Everything the handlers need, and the shutdown switch."""

    def __init__(self, root, app_name, version, config):
        self.root = root
        self.app_name = app_name
        self.version = version
        self.config = config
        self.web_dir = os.path.join(root, "web")
        self.assets_dir = os.path.join(root, "assets")
        self.packs_dir = os.path.join(root, "assets", "packs")
        self.projects_dir = os.path.join(root, "projects")
        self.exports_dir = os.path.join(root, "exports")
        self.extensions_dir = os.path.join(root, "extensions")
        self.save_config = lambda: None
        self.started = time.time()
        self.origins = set()
        self.hosts = set()
        self._server = None

    def bind(self, server):
        self._server = server

    def stop(self):
        if self._server:
            threading.Thread(target=self._server.shutdown, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    server_version = "Cartograph"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    ctx = None

    # ---------------------------------------------------------------- plumbing

    def log_message(self, fmt, *args):
        if self.ctx and self.ctx.config.get("verbose"):
            BaseHTTPRequestHandler.log_message(self, fmt, *args)

    def _send(self, status, ctype, body, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True                      # same-origin navigations send none
        return origin in self.ctx.origins

    def _host_ok(self):
        """Is this request addressed to us by a name we answer to?

        The Origin check stops another site *driving* the API, but not DNS
        rebinding: a page on attacker.example re-points its own name at
        127.0.0.1, and from then on it is same-origin with this server, so a
        GET carries no Origin at all and sails through. What it cannot change
        is the Host header, which still says attacker.example -- so refusing an
        unknown Host is what keeps a rebound page from reading every map, the
        folder paths and the config. A request with no Host is not a browser
        and is left to the other guards.
        """
        host = self.headers.get("Host")
        if host is None:
            return True
        return host.strip().lower() in self.ctx.hosts

    def _refuse(self, status, error):
        """Reject a request without reading its body, and hang up.

        This is a keep-alive server, so a body left unread stays on the socket
        and the parser reads it as the next request. An attacker who can make
        one request fail can therefore hide a second one in the body it never
        sent -- and that second one carries no Origin, so it passes the very
        check the first one just failed. Closing the connection is what makes
        the refusal actually refuse.
        """
        self.close_connection = True
        self._send(status, "application/json",
                   json.dumps({"ok": False, "error": error}).encode(),
                   {"Connection": "close"})
        return None

    def _body_length(self):
        """The declared body length, or -1 if the header is not a sane one."""
        seen = self.headers.get_all("Content-Length") or []
        # Two lengths that disagree are a desync in a bow: we would read one of
        # them and leave the difference on the socket for the next parse.
        if len(seen) > 1 and len(set(v.strip() for v in seen)) > 1:
            return -1
        raw = self.headers.get("Content-Length")
        if raw is None:
            return 0
        try:
            length = int(raw)
        except (TypeError, ValueError):
            return -1
        # A negative length reaches rfile.read(-1), which blocks until the peer
        # closes and pins the thread for as long as it cares to wait.
        return length if length >= 0 else -1

    # ------------------------------------------------------------------ verbs

    def do_GET(self):
        self._handle("GET")

    def do_HEAD(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_DELETE(self):
        self._handle("DELETE")

    def do_OPTIONS(self):
        # Same reasoning as _refuse: a body here would be left on the socket.
        # A chunked one has no declared length at all, so it is refused first.
        if self.headers.get("Transfer-Encoding"):
            return self._refuse(411, "a length is required")
        if self._body_length() != 0:
            return self._refuse(400, "no body expected")
        self._send(204, "text/plain", b"", {"Allow": "GET,HEAD,POST,PUT,DELETE,OPTIONS"})

    # ---------------------------------------------------------------- routing

    def _handle(self, method):
        try:
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
        except ValueError:
            # An absolute-form target with a malformed IPv6 literal raises out
            # of urlparse, and the handler then died without writing a byte --
            # the same shape as the NUL-byte hole safe.under() documents, one
            # layer up. This is before the body logic, so refusing is correct.
            return self._refuse(400, "bad request target")

        # Every refusal below hangs up rather than replying and reading on: see
        # _refuse. This runs before the routing split, not inside the /api/
        # branch, because a body left on the socket is read as the next request
        # whatever path it was addressed to -- the static branch answered a
        # cross-origin POST with 405 and read on, and the smuggled second
        # request carried no Origin and sailed through the guard the first one
        # had just failed. The length is settled first so that a malformed
        # header cannot reach rfile.read at all.
        if self.headers.get("Transfer-Encoding"):
            return self._refuse(411, "a length is required")
        length = self._body_length()
        if length < 0:
            return self._refuse(400, "bad Content-Length")
        if length > MAX_BODY:
            return self._refuse(413, "body too large")
        # Before the routing split, like everything above: a rebound page can
        # read static files under /projects/ as readily as it can call the API.
        if not self._host_ok():
            return self._refuse(421, "unknown host")

        if path.startswith("/api/"):
            # The check covers GET too. No GET handler has a side effect, but a
            # guard with a hole in it is a guard nobody can reason about.
            if not self._origin_ok():
                return self._refuse(403, "cross-origin request refused")
            body = self.rfile.read(length) if length else b""
            req = Request()
            req.ctx, req.method, req.path = self.ctx, method, path
            req.query = parse_qs(parsed.query)
            req.body = body
            req.headers = self.headers
            try:
                result = api.route(req)
            except Unsafe as exc:
                return self._send(403, "application/json",
                                  json.dumps({"ok": False, "error": str(exc)}).encode())
            except Exception as exc:                       # noqa: BLE001 - report, do not crash
                self.log_error("api %s %s: %s", method, path, exc)
                return self._send(500, "application/json",
                                  json.dumps({"ok": False, "error": repr(exc)}).encode())
            if result is None:
                return self._send(404, "application/json", b'{"ok":false,"error":"not found"}')
            status, ctype, payload = result
            return self._send(status, ctype, payload, {"Cache-Control": "no-store"})

        if method != "GET":
            return self._refuse(405, "method not allowed")

        # A static GET has no use for a body, but leaving one unread is the
        # same desync as above, so it is drained rather than ignored.
        if length:
            self.rfile.read(length)
        return self._static(path)

    # ------------------------------------------------------------ static files

    def _static(self, path):
        path = posixpath.normpath(path)
        if path in ("/", ""):
            path = "/index.html"

        if path.startswith("/assets/"):
            root, rel, cache = self.ctx.assets_dir, path[len("/assets/"):], "public, max-age=60"
        elif path.startswith("/extensions/"):
            root, rel, cache = self.ctx.extensions_dir, path[len("/extensions/"):], "no-store"
        elif path.startswith("/projects/"):
            root, rel, cache = self.ctx.projects_dir, path[len("/projects/"):], "no-store"
        else:
            root, rel, cache = self.ctx.web_dir, path.lstrip("/"), "no-store"

        try:
            target = under(root, *[p for p in rel.split("/") if p and p != "."])
        except Unsafe:
            return self._send(403, "text/plain", b"forbidden")

        if os.path.isdir(target):
            return self._send(403, "text/plain", b"no directory listing")
        if not os.path.isfile(target):
            return self._send(404, "text/plain", b"not found")

        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        try:
            with open(target, "rb") as fh:
                data = fh.read()
        except OSError:
            return self._send(404, "text/plain", b"not found")
        return self._send(200, ctype, data, {"Cache-Control": cache})


def serve(ctx, host="127.0.0.1", port=0):
    handler = type("BoundHandler", (Handler,), {"ctx": ctx})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    actual = httpd.server_address[1]
    ctx.origins = {"http://127.0.0.1:%d" % actual, "http://localhost:%d" % actual}
    ctx.hosts = {"127.0.0.1:%d" % actual, "localhost:%d" % actual}
    if actual == 80:                         # a browser leaves the default port off
        ctx.hosts |= {"127.0.0.1", "localhost"}
    ctx.bind(httpd)
    return httpd, actual
