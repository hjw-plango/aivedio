"""Check if last 'deploy-run.sh' actually rebuilt anything, and verify code in container."""
from __future__ import annotations
import os, sys
import paramiko  # type: ignore[import-untyped]

CHECKS = [
    ("cat /home/ubuntu/aivedio/docker-compose.deploy.yml | grep -A 3 -B 1 'app:' | head -40", "app service spec (full)"),
    ("grep -E 'build|context|dockerfile' /home/ubuntu/aivedio/docker-compose.deploy.yml || echo NO_BUILD_DIRECTIVE", "Has build: directive?"),
    ("docker images aivedio-studio:latest --format '{{.ID}} {{.CreatedSince}} {{.CreatedAt}}'", "aivedio-studio:latest image age"),
    ("docker inspect aivedio-app --format 'Container started: {{.State.StartedAt}}\\nImage SHA: {{.Image}}\\nImage Name: {{.Config.Image}}'", "aivedio-app vs image"),
    ("head -200 /home/ubuntu/aivedio/deploy.log", "Latest deploy.log head"),
    ("wc -l /home/ubuntu/aivedio/deploy.log", "deploy.log line count"),
    ("docker exec aivedio-app grep -c 'DEBUG-OCOMPAT-IMAGE' /app/src/lib/model-gateway/openai-compat/template-image.ts 2>&1", "DEBUG marker in CONTAINER /app/src"),
    ("ls -la /home/ubuntu/aivedio/src/lib/model-gateway/openai-compat/template-image.ts", "Marker in HOST file (should have DEBUG)"),
    ("grep -c 'DEBUG-OCOMPAT-IMAGE' /home/ubuntu/aivedio/src/lib/model-gateway/openai-compat/template-image.ts", "DEBUG count in HOST file"),
]

def main() -> int:
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=15, allow_agent=False, look_for_keys=False)
    try:
        for cmd, label in CHECKS:
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
