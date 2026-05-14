"""
Force a real rebuild + recreate of aivedio-app, bypassing the broken `--build`
in deploy-run.sh (compose file has no `build:` directive, so --build is a no-op).

Runs build synchronously over SSH with TCP keepalive — simplest and most reliable.
"""
from __future__ import annotations
import os, sys, time, threading
import paramiko  # type: ignore[import-untyped]

REMOTE_ROOT = "/home/ubuntu/aivedio"


def banner(text: str) -> None:
    print(f"\n========== {text} ==========", flush=True)


def stream_exec(client: "paramiko.SSHClient", cmd: str, idle_timeout: int = 600) -> int:
    """Run cmd, stream stdout/stderr to local stdout in real time, return rc.

    idle_timeout: max seconds without any output before aborting.
    """
    transport = client.get_transport()
    assert transport is not None
    chan = transport.open_session()
    chan.settimeout(idle_timeout)
    chan.set_combine_stderr(True)
    chan.exec_command(cmd)

    last_data = time.time()
    while True:
        if chan.recv_ready():
            data = chan.recv(8192)
            if data:
                sys.stdout.write(data.decode("utf-8", errors="replace"))
                sys.stdout.flush()
                last_data = time.time()
        if chan.exit_status_ready() and not chan.recv_ready():
            break
        if time.time() - last_data > idle_timeout:
            print(f"\n[stream] idle for {idle_timeout}s, aborting", file=sys.stderr)
            chan.close()
            return -1
        time.sleep(0.2)
    rc = chan.recv_exit_status()
    chan.close()
    return rc


def quick(client, cmd: str, timeout: int = 30) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def main() -> int:
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=20, allow_agent=False, look_for_keys=False)
    transport = client.get_transport()
    if transport is not None:
        transport.set_keepalive(30)
    print(f"[ssh] connected to {user}@{host} (keepalive=30s)")

    try:
        banner("Image age BEFORE build")
        rc, out, _ = quick(client, "docker images aivedio-studio:latest --format '{{.ID}} {{.CreatedSince}}'")
        print(out.strip())

        banner("Run docker build (synchronous, streamed)")
        # Stream so we see progress + paramiko keepalive prevents disconnect
        rc = stream_exec(
            client,
            f"cd {REMOTE_ROOT} && docker build -t aivedio-studio:latest . 2>&1",
            idle_timeout=600,
        )
        print(f"\n[build] exit rc={rc}")
        if rc != 0:
            banner("BUILD FAILED — aborting recreate")
            return rc

        banner("Image age AFTER build (should be 'About a minute ago')")
        rc, out, _ = quick(client, "docker images aivedio-studio:latest --format '{{.ID}} {{.CreatedSince}}'")
        print(out.strip())

        banner("Recreate aivedio-app (no-deps, force-recreate)")
        rc = stream_exec(
            client,
            f"cd {REMOTE_ROOT} && "
            f"docker compose --env-file .env.server -f docker-compose.deploy.yml "
            f"up -d --force-recreate --no-deps app 2>&1",
            idle_timeout=120,
        )
        print(f"\n[recreate] exit rc={rc}")
        if rc != 0:
            return rc

        banner("Wait for app readiness on :13000")
        ready = False
        for i in range(30):
            time.sleep(2)
            rc, out, _ = quick(client, "curl -sS -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:13000/")
            code = (out or "").strip()
            print(f"[health] +{(i+1)*2}s: {code}")
            if code in {"200", "301", "302", "307", "308"}:
                ready = True
                break

        banner("Verify DEBUG marker present in container /app/src")
        rc, out, _ = quick(client, "docker exec aivedio-app grep -c 'DEBUG-OCOMPAT-IMAGE' /app/src/lib/model-gateway/openai-compat/template-image.ts")
        cnt = (out or "").strip()
        print(f"marker count = {cnt}")
        if cnt != "4":
            print("[verify] WARN: expected 4 occurrences", file=sys.stderr)

        banner("Container info")
        rc, out, _ = quick(client, "docker ps --filter name=aivedio-app --format 'table {{.Names}}\\t{{.Status}}\\t{{.RunningFor}}'")
        print(out.rstrip())

        banner("Last 25 app log lines")
        rc, out, _ = quick(client, "docker logs --tail 25 aivedio-app 2>&1")
        print(out.rstrip())

        return 0 if ready else 6
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
