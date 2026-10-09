"""Serve exactly one APK for phone download. No API, filesystem browsing or uploads."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import shutil
APK = Path(__file__).resolve().parents[1] / "preview" / "SkopjeParking-connected.apk"
class DownloadHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/":
            body = b'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skopje Parking APK</title></head><body style="font:18px system-ui;padding:32px;color:#392c25;background:#faf3e5"><h1>Skopje Parking</h1><p>Android private test build with shared parking reports.</p><p><a href="/SkopjeParking-connected.apk">Download APK</a></p><p>The link is available while this download server is running.</p></body></html>'
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif path == "/SkopjeParking-connected.apk" and APK.is_file():
            self.send_response(200); self.send_header("Content-Type", "application/vnd.android.package-archive"); self.send_header("Content-Disposition", 'attachment; filename="SkopjeParking-connected.apk"'); self.send_header("Content-Length", str(APK.stat().st_size)); self.send_header("Cache-Control", "no-store"); self.end_headers()
            with APK.open("rb") as stream: shutil.copyfileobj(stream, self.wfile)
        else:
            self.send_error(404)
if __name__ == "__main__":
    print("APK-only download server listening on http://127.0.0.1:8766", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8766), DownloadHandler).serve_forever()
