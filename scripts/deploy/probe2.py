"""Second-pass probe: focus on existing aivedio deploy state."""
from __future__ import annotations
import os, sys
import paramiko  # type: ignore[import-untyped]

PROBES = [
    ("cd /home/ubuntu/aivedio && git remote -v",                    "Git remotes"),
    ("cd /home/ubuntu/aivedio && git status --short && git log --oneline -5", "Git status + recent commits"),
    ("cd /home/ubuntu/aivedio && git rev-parse HEAD",               "Remote HEAD"),
    ("ls /home/ubuntu/aivedio | head -40",                          "Repo top-level"),
    ("ls /home/ubuntu/aivedio/scripts/deploy 2>/dev/null",          "Existing deploy scripts"),
    ("ls /home/ubuntu/aivedio/scripts 2>/dev/null | grep -iE 'deploy|build|release' | head -20", "Deploy-related scripts"),
    ("cat /home/ubuntu/deploy.pid 2>/dev/null && echo '---' && ps -p $(cat /home/ubuntu/deploy.pid 2>/dev/null) 2>/dev/null", "Deploy PID file"),
    ("find /home/ubuntu -maxdepth 3 -name 'deploy*.sh' -o -name 'deploy*.py' 2>/dev/null | head -20", "Deploy scripts under home"),
    ("cd /home/ubuntu/aivedio && head -1 Dockerfile && wc -l Dockerfile", "Dockerfile head"),
    ("cd /home/ubuntu/aivedio && cat docker-compose.yml | head -80", "docker-compose.yml head"),
    ("cd /home/ubuntu/aivedio && ls -la .env* 2>/dev/null",         ".env files"),
    ("docker images | grep aivedio | head -5",                      "aivedio images"),
    ("docker logs --tail 20 aivedio-app 2>&1",                      "aivedio-app last 20 log lines"),
    ("docker inspect aivedio-app --format '{{.Config.Env}}' 2>&1 | tr ',' '\\n' | grep -vE 'PATH|NODE|HOSTNAME|HOME' | head -30", "aivedio-app env (filtered)"),
    ("docker inspect aivedio-app --format 'Image: {{.Config.Image}}\\nCreated: {{.Created}}\\nStatus: {{.State.Status}}'", "aivedio-app meta"),
    ("curl -sS -o /dev/null -w 'HTTP %{http_code} (%{time_total}s)\\n' http://127.0.0.1:13000/", "App health (port 13000)"),
    ("cat /etc/caddy/Caddyfile 2>/dev/null | head -60 || docker exec caddy cat /etc/caddy/Caddyfile 2>/dev/null | head -60", "Caddy config"),
    ("ls /home/ubuntu/aivedio/logs 2>/dev/null | head -10",         "App log dir"),
]

def main() -> int:
    host = os.environ["SSH_HOST"]
    user = os.environ["SSH_USER"]
    pwd = os.environ["SSH_PASSWORD"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=15, allow_agent=False, look_for_keys=False)
    print(f"[probe2] connected to {user}@{host}\n")
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
