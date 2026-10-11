"""Record public runner availability without retrieving private compiler inputs."""
import datetime
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path

tools = {}
for name in ("cmake", "ninja", "node", "git", "clang", "clang-cl", "rustc", "zig"):
    executable = shutil.which(name)
    if executable is None:
        tools[name] = {"available": False}
        continue
    try:
        result = subprocess.run(
            [executable, "--version"], capture_output=True, text=True, timeout=20
        )
        lines = (result.stdout + result.stderr).splitlines()
        tools[name] = {
            "available": True,
            "exit_code": result.returncode,
            "version": lines[0][:250] if lines else "",
        }
    except (OSError, subprocess.TimeoutExpired) as error:
        tools[name] = {"available": True, "probe_error": type(error).__name__}

receipt = {
    "scope": "Public standard runner availability; no compiler benchmark credit",
    "observed_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "platform": platform.system(),
    "machine": platform.machine(),
    "python": platform.python_version(),
    "cpu_count": os.cpu_count(),
    "workspace_free_bytes": shutil.disk_usage(Path.cwd()).free,
    "tools": tools,
    "private_compiler_inputs_fetched": False,
    "benchmarks_executed": False,
}
rendered = json.dumps(receipt, indent=2)
print(rendered)
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a", encoding="utf-8") as stream:
        stream.write("### Runner availability\n\n```json\n" + rendered + "\n```\n")
