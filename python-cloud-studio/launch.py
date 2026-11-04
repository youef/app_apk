"""Start the website on this computer and open it when the port is ready."""
import errno
import hashlib
import json
import os
import socket
import threading
import time
import webbrowser
from pathlib import Path
from urllib.request import ProxyHandler, build_opener

PORT = int(os.getenv('ALEZZ_PORT', '8765'))
URL = f'http://127.0.0.1:{PORT}'


def studio_revision():
    digest = hashlib.sha256()
    base = Path(__file__).resolve().parent
    for name in ('server.py', 'alezz_fetchv_importer.py', 'auto_sync.py', 'media_resolver.py'):
        digest.update((base / name).read_bytes())
    return digest.hexdigest()[:16]


def open_browser():
    for _ in range(90):
        try:
            with socket.create_connection(('127.0.0.1', PORT), timeout=.25):
                webbrowser.open(URL)
                return
        except OSError:
            time.sleep(.2)


def existing_studio():
    opener = build_opener(ProxyHandler({}))
    for _ in range(10):
        try:
            with opener.open(URL + '/healthz', timeout=.5) as response:
                info = json.load(response)
                return info if info.get('service') == 'al-ezz-tv-python-studio' else None
        except (OSError, ValueError, AttributeError):
            time.sleep(.2)
    return None


def main():
    with socket.socket() as listener:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind(('127.0.0.1', PORT))
        except OSError as exc:
            if exc.errno != errno.EADDRINUSE and getattr(exc, 'winerror', None) != 10048:
                raise
            running = existing_studio()
            if running:
                if running.get('studio_revision') != studio_revision():
                    print(f'An older Al Ezz TV server is still running at {URL}.')
                    print('Stop the existing server, then start this launcher again.')
                    return 1
                print(f'Al Ezz TV is already running at {URL}')
                webbrowser.open(URL)
                return 0
            print(f'Port {PORT} is in use by another application. Set ALEZZ_PORT to a free port.')
            return 1

        os.chdir(Path(__file__).resolve().parent)
        from server import app
        import uvicorn

        print(f'AL EZZ TV | Open: {URL} | To stop: Ctrl+C')
        threading.Thread(target=open_browser, daemon=True).start()
        config = uvicorn.Config(app, host='127.0.0.1', port=PORT, log_level='warning',
                                access_log=False, proxy_headers=False)
        uvicorn.Server(config).run(sockets=[listener])
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
