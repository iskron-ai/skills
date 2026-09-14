"""Run the guest owner's exact container controls through OpenCode HTTP shell."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

base, session, peer_scripts, client, node = sys.argv[1:]
sys.path.insert(0, str(Path(peer_scripts) / "tests"))
import container_controls

original = subprocess.run


def through_http(args, **kwargs):
    if len(args) != 1 or Path(args[0]).name != "acceptance.sh":
        return original(args, **kwargs)
    result = original([node, client, "shell", base, session, str(args[0])],
                      stdin=subprocess.DEVNULL, capture_output=True, text=True,
                      timeout=60, env={**os.environ, "VERIFY_OPENCODE_NO_AUTH": "1",
                                      "VERIFY_OPENCODE_MODEL": "fixture/fixture"})
    if result.returncode == 0:
        assert result.stderr == "", "unexpected CLI stderr"
        assert '"shellCompleted":true' in result.stdout
    else:
        assert result.returncode == 1
        assert "Shell failed or result incomplete" in result.stderr
    # Preserve the exact installer's JSON receipts for the owner's assertions.
    lines = [line for line in result.stdout.splitlines()
             if line.strip() and "shellCompleted" not in json.loads(line)]
    return subprocess.CompletedProcess(args, result.returncode, "\n".join(lines) + "\n", "")


subprocess.run = through_http
suite = unittest.defaultTestLoader.loadTestsFromModule(container_controls)
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
