"""Convenience launcher for the local web prototype."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
parser = argparse.ArgumentParser()
parser.add_argument('--open', action='store_true')
parser.add_argument('--port', type=int, default=8765)
args = parser.parse_args()
root = Path(__file__).resolve().parent
bundled = Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
node = shutil.which('node') or (str(bundled) if bundled.is_file() else None)
if not node:
    raise SystemExit('Node.js 20+ diperlukan untuk server prototipe.')
os.environ['OMNI_PORT'] = str(args.port)
if args.open:
    subprocess.Popen(['/usr/bin/python3', '-c', 'import time,webbrowser;time.sleep(1);webbrowser.open(%r)' % ('http://127.0.0.1:%d' % args.port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
os.execv(node, [node, str(root/'server.mjs')])
