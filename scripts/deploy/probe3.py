"""Third-pass probe: read deploy-run.sh and docker-compose.deploy.yml verbatim."""
from __future__ import annotations
import os, sys
import paramiko  # type: ignore[import-untyped]

PROBES = [
    ("cat /home/ubuntu/aivedio/deploy-run.sh",                "deploy-run.sh"),
    ("cat /home/ubuntu/aivedio/docker-compose.deploy.yml",    "docker-compose.deploy.yml"),
    ("cat /home/ubuntu/aivedio/Dockerfile",                   "Dockerfile"),
    ("tail -80 /home/ubuntu/aivedio/deploy.log 2>/dev/null",  "Recent deploy log"),
    ("tail -10 /home/ubuntu/aivedio/deploy.exit 2>/dev/null", "Recent deploy exit"),
    ("cat /home/ubuntu/aivedio/.env.server | grep -vE '^(#|$)' | sed -E 's/(API_KEY|PASSWORD|SECRET|TOKEN)=.*/\\1=<redacted>/' | head -40", ".env.server (redacted)"),
    ("ls /home/ubuntu/aivedio/probe 2>/dev/null && ls /home/ubuntu/probe 2>/dev/null", "probe dirs"),
    ("ls -la /home/ubuntu/aivedio/scripts/deploy 2>/dev/null", "Local deploy scripts dir present?"),
    ("ls /home/ubuntu/aivedio/docker-logs 2>/dev/null | head -10", "docker-logs dir"),
    ("ls /home/ubuntu/aivedio/data 2>/dev/null", "data dir"),
    ("docker volume ls | head -20", "docker volumes"),
]

def main() -> int:
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=15, allow_agent=False, look_for_keys=False)
    print(f"[probe3] connected to {user}@{host}\n")
    try:
        for cmd, label in PROBES:
            stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            rc = stdout.channel.recv_exit_status()
            print(f"\n========== {label} ==========\n$ {cmd}")
            if out.strip(): print(out.rstrip())
            if err.strip(): print(f"[stderr] {err.rstrip()}")
            print(f"[rc={rc}]")
    finally:
        client.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
