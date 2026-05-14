"""
Background docker build is already running on the server (from a prior attempt).
Just poll /tmp/aivedio-build.exit, then force-recreate the app container.

UTF-8 stdout safe for Windows (GBK) consoles.
"""
from __future__ import annotations
import os, sys, time
# Force UTF-8 stdout on Windows (so build output with ✔ etc doesn't crash)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

import paramiko  # type: ignore[import-untyped]

REMOTE_ROOT = "/home/ubuntu/aivedio"
BUILD_LOG = "/tmp/aivedio-build.log"
BUILD_EXIT = "/tmp/aivedio-build.exit"
BUILD_PID = "/tmp/aivedio-build.pid"


def quick(client, cmd: str, timeout: int = 30) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def banner(text: str) -> None:
    print(f"\n========== {text} ==========", flush=True)


def main() -> int:
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=20, allow_agent=False, look_for_keys=False)
    transport = client.get_transport()
    if transport is not None:
        transport.set_keepalive(30)
    print(f"[ssh] connected to {user}@{host}")

    try:
        banner("Confirm a build is in progress")
        rc, out, _ = quick(client, "ps -ef | grep -E 'docker build' | grep -v grep")
        print(out.strip() or "(none)")
        if "docker build" not in out:
            print("[poll] no build running — has it finished?")

        rc, out, _ = quick(client, f"test -f {BUILD_EXIT} && cat {BUILD_EXIT} || echo PENDING")
        print(f"[poll] {BUILD_EXIT}: {out.strip()}")

        banner("Poll build until exit-code file appears (max 25 min)")
        deadline = time.time() + 25 * 60
        last_size = 0
        exit_code: str | None = None
        while time.time() < deadline:
            time.sleep(8)
            rc, out, _ = quick(client, f"test -f {BUILD_EXIT} && cat {BUILD_EXIT}")
            if rc == 0 and out.strip():
                exit_code = out.strip()
                break
            rc2, sz_out, _ = quick(client, f"wc -c < {BUILD_LOG}")
            try:
                cur_size = int(sz_out.strip())
            except ValueError:
                cur_size = last_size
            if cur_size > last_size:
                rc3, new_out, _ = quick(client, f"tail -c +{last_size + 1} {BUILD_LOG} | tail -n 10")
                txt = new_out.rstrip()
                if txt:
                    print(txt)
                last_size = cur_size
            else:
                print(".", end="", flush=True)
        print()
        if exit_code is None:
            print("[poll] TIMEOUT — build still running, abort", file=sys.stderr)
            return 5
        if exit_code != "0":
            banner(f"BUILD FAILED rc={exit_code} — last 100 lines")
            rc, out, _ = quick(client, f"tail -100 {BUILD_LOG}")
            print(out)
            return int(exit_code)

        banner("Build succeeded — image age now")
        rc, out, _ = quick(client, "docker images aivedio-studio:latest --format '{{.ID}} {{.CreatedSince}}'")
        print(out.strip())

        banner("Force-recreate aivedio-app (no-deps)")
        cmd = (
            f"cd {REMOTE_ROOT} && "
            f"docker compose --env-file .env.server -f docker-compose.deploy.yml "
            f"up -d --force-recreate --no-deps app 2>&1"
        )
        rc, out, _ = quick(client, cmd, timeout=180)
        print(out.rstrip())
        if rc != 0:
            return rc

        banner("Wait for app readiness on :13000 (max 60s)")
        ready = False
        for i in range(30):
            time.sleep(2)
            rc, out, _ = quick(client, "curl -sS -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:13000/")
            code = (out or "").strip()
            print(f"[health] +{(i+1)*2}s: {code}")
            if code in {"200", "301", "302", "307", "308"}:
                ready = True
                break

        banner("Verify DEBUG marker is present in container's /app/src")
        rc, out, _ = quick(client, "docker exec aivedio-app grep -c 'DEBUG-OCOMPAT-IMAGE' /app/src/lib/model-gateway/openai-compat/template-image.ts")
        cnt = (out or "").strip()
        print(f"marker count = {cnt} (expected 4)")

        banner("Container info")
        rc, out, _ = quick(client, "docker ps --filter name=aivedio-app --format 'table {{.Names}}\\t{{.Status}}\\t{{.RunningFor}}'")
        print(out.rstrip())

        banner("Last 25 app log lines")
        rc, out, _ = quick(client, "docker logs --tail 25 aivedio-app 2>&1")
        print(out.rstrip())

        return 0 if ready and cnt == "4" else 6
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
