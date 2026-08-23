"""Worker test suite (`python3 -m unittest discover -s worker/tests -t .`).

The worker runs as a script: its modules import flat (`api_client`, `whisper_output`,
`wisper_worker`). So we make `worker/` importable the same way from the tests, whatever the
discovery directory is.
"""

import os
import sys

WORKER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)
