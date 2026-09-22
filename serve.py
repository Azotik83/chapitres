# Petit serveur de developpement.
#
#     python serve.py          puis  http://localhost:8080
#
# Un service worker et l'installation PWA ne marchent pas depuis
# file:// : il faut un vrai serveur HTTP, meme en local.
import http.server, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def guess_type(self, path):
        t = super().guess_type(path)
        if isinstance(t, tuple):
            t = t[0]
        if t == "text/html":
            return "text/html; charset=utf-8"
        if path.endswith(".webmanifest"):
            return "application/manifest+json"
        if path.endswith(".js"):
            return "text/javascript; charset=utf-8"
        return t

    def end_headers(self):
        # Pas de cache en developpement, sinon on debogue une vieille version.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

print("Chapitres sur http://localhost:%d" % PORT)
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
