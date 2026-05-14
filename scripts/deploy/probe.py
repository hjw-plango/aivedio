"""
Remote server probe — discover what's already on the box before we deploy.

Usage (PowerShell / bash):
    SSH_HOST=43.135.148.152 SSH_USER=ubuntu SSH_PASSWORD='...' python scripts/deploy/probe.py

DO NOT commit credentials. Read from env only. Output is plain text — pipe into a file
if you want to keep it.
"""
from __future__ import annotations

import os
import sys
from typing import Iterable

try:
    import paramiko  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: paramiko not installed. Run: pip install paramiko", file=sys.stderr)
    sys.exit(1)


PROBES: list[tuple[str, str]] = [
    ("uname -a",                        "OS / kernel"),
    ("cat /etc/os-release | head -5",   "Distribution"),
    ("nproc && free -h && df -h /",     "Resources"),
    ("which node && node -v",           "Node"),
    ("which npm && npm -v",             "npm"),
    ("which docker && docker --version","Docker"),
    ("which docker-compose; docker compose version 2>/dev/null", "Compose"),
    ("which git && git --version",      "git"),
    ("which pm2 && pm2 -v",             "pm2"),
    ("which nginx && nginx -v 2>&1",    "nginx"),
    ("which caddy && caddy version",    "caddy"),
    ("ls -la /home/ubuntu",             "Home dir"),
    ("ls -la /opt 2>/dev/null",         "/opt"),
    ("find /home/ubuntu /opt /srv -maxdepth 3 -name 'aivedio*' -o -name 'package.json' 2>/dev/null | head -20", "Existing aivedio / node projects"),
    ("docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null", "Running containers"),
    ("ss -tlnp 2>/dev/null | head -20 || netstat -tlnp 2>/dev/null | head -20", "Listening ports"),
    ("systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -25", "Running systemd services"),
    ("pm2 list 2>/dev/null",            "pm2 processes"),
]


def run(client: "paramiko.SSHClient", cmd: str, timeout: int = 20) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def main() -> int:
    host = os.environ.get("SSH_HOST")
    user = os.environ.get("SSH_USER")
    password = os.environ.get("SSH_PASSWORD")
    port = int(os.environ.get("SSH_PORT", "22"))

    missing = [name for name, val in (("SSH_HOST", host), ("SSH_USER", user), ("SSH_PASSWORD", password)) if not val]
    if missing:
        print(f"ERROR: missing env vars: {', '.join(missing)}", file=sys.stderr)
        return 2

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[probe] connecting to {user}@{host}:{port} ...", flush=True)
    try:
        client.connect(
            hostname=host,
            port=port,
            username=user,
            password=password,
            timeout=15,
            allow_agent=False,
            look_for_keys=False,
        )
    except Exception as exc:
        print(f"[probe] CONNECT FAILED: {exc}", file=sys.stderr)
        return 1

    print(f"[probe] connected.\n", flush=True)
    try:
        for cmd, label in PROBES:
            print(f"\n========== {label} ==========")
            print(f"$ {cmd}")
            rc, out, err = run(client, cmd)
            if out.strip():
                print(out.rstrip())
            if err.strip():
                print(f"[stderr] {err.rstrip()}")
            print(f"[rc={rc}]")
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
