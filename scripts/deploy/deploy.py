"""
Full deploy: sync whitelisted source -> remote, then real `docker build` + force-recreate.

Bypasses the broken `--build` in deploy-run.sh (compose file has no `build:` directive
so --build is a no-op). Use this script for any source-code change.

Usage:
    SSH_HOST=43.135.148.152 SSH_USER=ubuntu SSH_PASSWORD='...' \\
        python scripts/deploy/deploy.py

Optional:
    SKIP_SYNC=1   # skip the tarball upload, just rebuild + recreate
    SKIP_BUILD=1  # skip rebuild, just recreate (only useful when image is already fresh)
"""
from __future__ import annotations

import io
import os
import sys
import tarfile
import time

# Force UTF-8 stdout on Windows (build output has ✔ etc.)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

try:
    import paramiko  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: paramiko not installed. Run: pip install paramiko", file=sys.stderr)
    sys.exit(1)


REMOTE_ROOT = "/home/ubuntu/aivedio"
BUILD_LOG = "/tmp/aivedio-build.log"
BUILD_EXIT = "/tmp/aivedio-build.exit"
BUILD_PID = "/tmp/aivedio-build.pid"

SYNC_DIRS = ["src", "prisma", "scripts", "standards", "lib", "messages", "public", "assets"]
SYNC_FILES = [
    "package.json", "package-lock.json", "Dockerfile",
    "middleware.ts", "next.config.ts", "postcss.config.mjs",
    "tsconfig.json", "eslint.config.mjs", "next-env.d.ts", ".dockerignore",
]
EXCLUDE_DIR_NAMES = {
    "node_modules", ".next", ".git", "__pycache__", ".turbo", "coverage",
    "AIComicBuilder-main",
}
EXCLUDE_FILE_SUFFIXES = (".pyc", ".tsbuildinfo")
EXCLUDE_FILE_NAMES = {".DS_Store"}


def make_tarball(local_root: str) -> bytes:
    buf = io.BytesIO()

    def filter_(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo | None:
        parts = tarinfo.name.replace("\\", "/").split("/")
        if any(p in EXCLUDE_DIR_NAMES for p in parts):
            return None
        base = parts[-1] if parts else ""
        if base in EXCLUDE_FILE_NAMES:
            return None
        if any(base.endswith(suf) for suf in EXCLUDE_FILE_SUFFIXES):
            return None
        tarinfo.uid = 1000; tarinfo.gid = 1000
        tarinfo.uname = "ubuntu"; tarinfo.gname = "ubuntu"
        return tarinfo

    with tarfile.open(mode="w:gz", fileobj=buf) as tar:
        for d in SYNC_DIRS:
            full = os.path.join(local_root, d)
            if os.path.isdir(full):
                tar.add(full, arcname=d, filter=filter_)
        for f in SYNC_FILES:
            full = os.path.join(local_root, f)
            if os.path.isfile(full):
                tar.add(full, arcname=f, filter=filter_)
    return buf.getvalue()


def quick(client, cmd: str, timeout: int = 30) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def banner(text: str) -> None:
    print(f"\n========== {text} ==========", flush=True)


def sync(client, local_root: str) -> int:
    banner("Pack whitelist tarball")
    tgz = make_tarball(local_root)
    size_mb = len(tgz) / 1024 / 1024
    print(f"[pack] {size_mb:.2f} MB ({len(SYNC_DIRS)} dirs + {len(SYNC_FILES)} files)")

    banner("Upload via SFTP")
    remote_tgz = f"/tmp/aivedio-deploy-{int(time.time())}.tgz"
    sftp = client.open_sftp()
    try:
        with sftp.file(remote_tgz, "wb") as remote_f:
            remote_f.set_pipelined(True)
            remote_f.write(tgz)
    finally:
        sftp.close()
    print(f"[sftp] {remote_tgz}")

    banner("Extract over remote root")
    rc, out, err = quick(client, f"cd {REMOTE_ROOT} && tar xzf {remote_tgz} && rm {remote_tgz}")
    print(out.rstrip())
    if err.strip(): print(f"[stderr] {err.rstrip()}")
    return rc


def build_in_background(client) -> str:
    """Launch docker build detached. Returns the launched PID."""
    banner("Image age BEFORE build")
    rc, out, _ = quick(client, "docker images aivedio-studio:latest --format '{{.ID}} {{.CreatedSince}}'")
    print(out.strip())

    banner("Launch docker build (detached via setsid -f, logs -> /tmp/aivedio-build.log)")
    # setsid -f forks into a new session AND detaches — the launching shell returns
    # cleanly so paramiko's channel sees EOF without hanging on inherited fds.
    cmd = (
        f": > {BUILD_LOG} && rm -f {BUILD_EXIT} && "
        f"setsid -f bash -c "
        f"'cd {REMOTE_ROOT} && docker build -t aivedio-studio:latest . ; echo $? > {BUILD_EXIT}' "
        f"< /dev/null > {BUILD_LOG} 2>&1 && "
        f"echo OK"
    )
    rc, out, _ = quick(client, cmd, timeout=15)
    print(f"[build] launch result: {out.strip() or '(no output)'}")
    # Give the forked process a moment to start; PID is whatever's writing to BUILD_LOG
    time.sleep(2)
    rc, out, _ = quick(client, f"pgrep -f 'docker build -t aivedio-studio' | head -1")
    pid = out.strip() or "unknown"
    print(f"[build] docker build pid={pid}")
    return pid


def poll_build(client, max_minutes: int = 25) -> str:
    banner(f"Poll build (max {max_minutes} min)")
    deadline = time.time() + max_minutes * 60
    last_size = 0
    while time.time() < deadline:
        time.sleep(8)
        rc, out, _ = quick(client, f"test -f {BUILD_EXIT} && cat {BUILD_EXIT}")
        if rc == 0 and out.strip():
            print(f"\n[build] exit code: {out.strip()}")
            return out.strip()
        rc2, sz_out, _ = quick(client, f"wc -c < {BUILD_LOG}")
        try:
            cur_size = int(sz_out.strip())
        except ValueError:
            cur_size = last_size
        if cur_size > last_size:
            rc3, new_out, _ = quick(client, f"tail -c +{last_size + 1} {BUILD_LOG} | tail -n 8")
            txt = new_out.rstrip()
            if txt:
                print(txt)
            last_size = cur_size
        else:
            print(".", end="", flush=True)
    return "TIMEOUT"


def recreate_and_verify(client) -> int:
    banner("Image age AFTER build")
    rc, out, _ = quick(client, "docker images aivedio-studio:latest --format '{{.ID}} {{.CreatedSince}}'")
    print(out.strip())

    banner("Force-recreate aivedio-app (no-deps)")
    cmd = (
        f"cd {REMOTE_ROOT} && "
        f"docker compose --env-file .env.server -f docker-compose.deploy.yml "
        f"up -d --force-recreate --no-deps app 2>&1"
    )
    rc, out, _ = quick(client, cmd, timeout=120)
    print(out.rstrip())
    if rc != 0:
        return rc

    banner("Wait for :13000 readiness (max 60s)")
    ready = False
    for i in range(30):
        time.sleep(2)
        rc, out, _ = quick(client, "curl -sS -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:13000/")
        code = (out or "").strip()
        print(f"[health] +{(i+1)*2}s: {code}")
        if code in {"200", "301", "302", "307", "308"}:
            ready = True
            break

    banner("Container info")
    rc, out, _ = quick(client, "docker ps --filter name=aivedio-app --format 'table {{.Names}}\\t{{.Status}}\\t{{.RunningFor}}'")
    print(out.rstrip())

    banner("Last 20 app log lines")
    rc, out, _ = quick(client, "docker logs --tail 20 aivedio-app 2>&1")
    print(out.rstrip())

    return 0 if ready else 6


def main() -> int:
    local_root = os.environ.get("LOCAL_ROOT", os.getcwd()).replace("\\", "/")
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    skip_sync = os.environ.get("SKIP_SYNC") == "1"
    skip_build = os.environ.get("SKIP_BUILD") == "1"

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=20, allow_agent=False, look_for_keys=False)
    transport = client.get_transport()
    if transport is not None:
        transport.set_keepalive(30)
    print(f"[ssh] {user}@{host} (keepalive=30s)")

    try:
        if not skip_sync:
            rc = sync(client, local_root)
            if rc != 0:
                print(f"[sync] FAILED rc={rc}", file=sys.stderr)
                return rc
        else:
            print("[sync] skipped (SKIP_SYNC=1)")

        if not skip_build:
            build_in_background(client)
            exit_code = poll_build(client)
            if exit_code != "0":
                banner(f"BUILD FAILED ({exit_code}) — last 80 lines of build log")
                rc, out, _ = quick(client, f"tail -80 {BUILD_LOG}")
                print(out)
                return 1 if exit_code == "TIMEOUT" else int(exit_code)
        else:
            print("[build] skipped (SKIP_BUILD=1)")

        return recreate_and_verify(client)
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
