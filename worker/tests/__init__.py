"""Suite de tests du worker (`python3 -m unittest discover -s worker/tests -t .`).

Le worker s'exécute comme un script : ses modules s'importent à plat (`api_client`,
`whisper_output`, `wisper_worker`). On rend donc `worker/` importable de la même façon
depuis les tests, quel que soit le répertoire de découverte.
"""

import os
import sys

WORKER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)
