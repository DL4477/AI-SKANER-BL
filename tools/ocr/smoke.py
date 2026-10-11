"""Exercise the bundled worker over its actual JSONL protocol; no cloud requests."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
executable = Path(sys.argv[1]) if len(sys.argv)>1 else root / '.local/ocr-dist/ocr-worker/ocr-worker.exe'
picture = Path(sys.argv[2]) if len(sys.argv)>2 else root / '.local/pinol-review-end.png'
worker = subprocess.Popen([str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          creationflags=0x08000000, encoding='utf-8')
started = time.perf_counter()
try:
    for mode in ('status', 'primary', 'secondary'):
        request = {'mode': mode}
        if mode != 'status':
            request['image'] = 'data:image/png;base64,' + base64.b64encode(picture.read_bytes()).decode('ascii')
        worker.stdin.write(json.dumps(request)+'\n'); worker.stdin.flush()
        response = json.loads(worker.stdout.readline())
        assert response['ok'], (response, worker.stderr.read(1000) if worker.poll() is not None else '')
        assert mode=='status' or response['data']['regions'], 'No text detected in smoke image'
        print(json.dumps({'mode':mode,'elapsed':round(time.perf_counter()-started,2),**response['data']},ensure_ascii=True))
finally:
    worker.kill(); worker.wait(timeout=10)
