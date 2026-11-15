"""Start the website on this computer and open it when the port is ready."""
import os
import socket
import threading
import time
import webbrowser
from pathlib import Path

PORT = int(os.getenv('ALEZZ_PORT', '8765'))
URL = f'http://127.0.0.1:{PORT}'


def open_browser():
    for _ in range(90):
        try:
            with socket.create_connection(('127.0.0.1', PORT), timeout=.25):
                webbrowser.open(URL)
                return
        except OSError:
            time.sleep(.2)


if __name__ == '__main__':
    os.chdir(Path(__file__).resolve().parent)
    from server import app
    import uvicorn
    print('\n' + '='*56)
    print('  AL EZZ TV | Python Web Import Studio')
    print('  Open: ' + URL)
    print('  To stop: press Ctrl+C')
    print('='*56 + '\n')
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning', access_log=False)
