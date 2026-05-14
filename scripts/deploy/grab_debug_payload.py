"""Grab DEBUG-OCOMPAT-IMAGE payload from aivedio-app docker logs."""
from __future__ import annotations
import os, sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass
import paramiko  # type: ignore[import-untyped]


def main() -> int:
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=15, allow_agent=False, look_for_keys=False)
    try:
        # 1. grep DEBUG marker (last 30 min) — that's the gold
        cmd1 = "docker logs --since 30m aivedio-app 2>&1 | grep -A 2 'DEBUG-OCOMPAT-IMAGE'"
        _, o, _ = client.exec_command(cmd1, timeout=30)
        out = o.read().decode("utf-8", errors="replace")
        print("========== DEBUG-OCOMPAT-IMAGE matches ==========")
        print(out.rstrip() or "(none)")

        # 2. Last 100 lines of error-related logs as context
        cmd2 = "docker logs --since 30m aivedio-app 2>&1 | grep -iE 'OUTPUT_NOT_FOUND|ERROR|template-image|ocompat|gpt-image' | tail -50"
        _, o, _ = client.exec_command(cmd2, timeout=30)
        out2 = o.read().decode("utf-8", errors="replace")
        print("\n========== Error / ocompat context (last 50) ==========")
        print(out2.rstrip() or "(none)")

        # 3. Plain last 80 lines for full sequence
        cmd3 = "docker logs --since 30m aivedio-app 2>&1 | tail -80"
        _, o, _ = client.exec_command(cmd3, timeout=30)
        out3 = o.read().decode("utf-8", errors="replace")
        print("\n========== Last 80 lines (raw) ==========")
        print(out3.rstrip() or "(none)")
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
