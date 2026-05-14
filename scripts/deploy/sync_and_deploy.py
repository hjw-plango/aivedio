"""
Sync local working tree to remote /home/ubuntu/aivedio and trigger deploy-run.sh.

Whitelist-only: never touches .env.server, data/, docker-logs/, deploy-*.{sh,log,exit,pid},
docker-compose.deploy.yml, .git/, AIComicBuilder-main/.

Usage:
    SSH_HOST=43.135.148.152 SSH_USER=ubuntu SSH_PASSWORD='...' \\
        python scripts/deploy/sync_and_deploy.py
"""
from __future__ import annotations

import io
import os
import sys
import tarfile
import time
from typing import Iterable

try:
    import paramiko  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: paramiko not installed. Run: pip install paramiko", file=sys.stderr)
    sys.exit(1)


SYNC_DIRS = [
    "src",
    "prisma",
    "scripts",
    "standards",
    "lib",
    "messages",
    "public",
    "assets",
]

SYNC_FILES = [
    "package.json",
    "package-lock.json",
    "Dockerfile",
    "middleware.ts",
    "next.config.ts",
    "postcss.config.mjs",
    "tsconfig.json",
    "eslint.config.mjs",
    "next-env.d.ts",
    ".dockerignore",
]

EXCLUDE_DIR_NAMES = {
    "node_modules",
    ".next",
    ".git",
    "__pycache__",
    ".turbo",
    "coverage",
    "AIComicBuilder-main",
}

EXCLUDE_FILE_SUFFIXES = (
    ".pyc",
    ".tsbuildinfo",
)

EXCLUDE_FILE_NAMES = {
    ".DS_Store",
}

REMOTE_ROOT = "/home/ubuntu/aivedio"


def make_tarball(local_root: str) -> bytes:
    """Pack whitelisted dirs + files into an in-memory tar.gz."""
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
        # normalize permissions so tarball is reproducible
        tarinfo.uid = 1000
        tarinfo.gid = 1000
        tarinfo.uname = "ubuntu"
        tarinfo.gname = "ubuntu"
        return tarinfo

    with tarfile.open(mode="w:gz", fileobj=buf) as tar:
        for d in SYNC_DIRS:
            full = os.path.join(local_root, d)
            if os.path.isdir(full):
                tar.add(full, arcname=d, filter=filter_)
            else:
                print(f"[pack] WARN: dir not found, skipping: {d}")
        for f in SYNC_FILES:
            full = os.path.join(local_root, f)
            if os.path.isfile(full):
                tar.add(full, arcname=f, filter=filter_)
            else:
                print(f"[pack] WARN: file not found, skipping: {f}")
    return buf.getvalue()


def run(client: "paramiko.SSHClient", cmd: str, timeout: int = 60) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def banner(text: str) -> None:
    print(f"\n========== {text} ==========", flush=True)


def main() -> int:
    local_root = os.environ.get("LOCAL_ROOT", os.getcwd()).replace("\\", "/")
    host = os.environ.get("SSH_HOST")
    user = os.environ.get("SSH_USER")
    pwd = os.environ.get("SSH_PASSWORD")
    if not (host and user and pwd):
        print("ERROR: set SSH_HOST / SSH_USER / SSH_PASSWORD", file=sys.stderr)
        return 2

    banner("Pack whitelist into tar.gz")
    print(f"local_root = {local_root}")
    tgz = make_tarball(local_root)
    size_mb = len(tgz) / 1024 / 1024
    print(f"[pack] tarball size: {size_mb:.2f} MB")
    if size_mb > 200:
        print(f"[pack] WARN: tarball is large ({size_mb:.1f} MB) — check excludes")

    banner("Connect SSH")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host,
        username=user,
        password=pwd,
        timeout=20,
        allow_agent=False,
        look_for_keys=False,
    )
    print(f"[ssh] connected to {user}@{host}")

    try:
        banner("Verify any deploy is currently running")
        rc, out, err = run(client, f"test -f {REMOTE_ROOT}/deploy.pid && pid=$(cat {REMOTE_ROOT}/deploy.pid) && ps -p $pid -o pid= 2>/dev/null && echo BUSY || echo IDLE")
        print(out.strip() or "IDLE (no pid file)")
        if "BUSY" in out:
            print("[ssh] another deploy in progress — abort", file=sys.stderr)
            return 3

        banner("Upload tarball via SFTP")
        remote_tgz = f"/tmp/aivedio-deploy-{int(time.time())}.tgz"
        sftp = client.open_sftp()
        try:
            with sftp.file(remote_tgz, "wb") as remote_f:
                remote_f.set_pipelined(True)
                remote_f.write(tgz)
        finally:
            sftp.close()
        print(f"[sftp] wrote {remote_tgz} ({size_mb:.2f} MB)")

        banner("Extract over remote root (whitelist only — no destructive removes)")
        # extract; tar will overwrite files in whitelisted dirs but won't touch siblings
        # like .env.server / data / docker-logs / deploy-run.sh / docker-compose.deploy.yml
        rc, out, err = run(client, f"cd {REMOTE_ROOT} && tar xzf {remote_tgz} && rm {remote_tgz}")
        print(out.rstrip())
        if err.strip():
            print(f"[stderr] {err.rstrip()}")
        if rc != 0:
            print(f"[extract] FAILED rc={rc}", file=sys.stderr)
            return 4

        banner("Sanity: confirm template-image.ts contains DEBUG-OCOMPAT-IMAGE marker")
        rc, out, err = run(client, f"grep -c 'DEBUG-OCOMPAT-IMAGE' {REMOTE_ROOT}/src/lib/model-gateway/openai-compat/template-image.ts")
        print(f"marker count = {out.strip()}")
        if rc != 0 or out.strip() == "0":
            print("[sanity] WARN: debug log marker not found in remote file", file=sys.stderr)

        banner("Trigger deploy-run.sh in background (build + recreate)")
        # write fresh pid file, redirect output to deploy.log
        cmd = (
            f"cd {REMOTE_ROOT} && "
            f": > deploy.log && rm -f deploy.exit && "
            f"nohup bash deploy-run.sh > deploy.log 2>&1 & "
            f"echo $! > deploy.pid && cat deploy.pid"
        )
        rc, out, err = run(client, cmd)
        deploy_pid = out.strip()
        print(f"[deploy] launched pid={deploy_pid} (logs -> {REMOTE_ROOT}/deploy.log)")

        banner("Poll deploy.exit (build typically 3-6 min)")
        deadline = time.time() + 12 * 60
        last_log_size = 0
        exit_code: str | None = None
        while time.time() < deadline:
            time.sleep(8)
            rc, out, err = run(client, f"test -f {REMOTE_ROOT}/deploy.exit && cat {REMOTE_ROOT}/deploy.exit")
            if rc == 0 and out.strip():
                exit_code = out.strip()
                break
            # incremental log tail
            rc2, out2, err2 = run(client, f"wc -c < {REMOTE_ROOT}/deploy.log")
            try:
                cur_size = int(out2.strip())
            except ValueError:
                cur_size = last_log_size
            if cur_size > last_log_size:
                # show new lines (use byte offset via dd to avoid re-reading)
                rc3, new_out, _ = run(
                    client,
                    f"tail -c +{last_log_size + 1} {REMOTE_ROOT}/deploy.log | tail -n 8",
                )
                stripped = new_out.rstrip()
                if stripped:
                    print(stripped)
                last_log_size = cur_size
            else:
                print(".", end="", flush=True)
        print()
        if exit_code is None:
            print("[deploy] TIMEOUT after 12min — leaving deploy running, check manually", file=sys.stderr)
            return 5

        banner(f"Deploy finished with exit={exit_code}")
        rc, out, err = run(client, f"tail -50 {REMOTE_ROOT}/deploy.log")
        print(out.rstrip())

        banner("docker ps")
        rc, out, err = run(client, "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'")
        print(out.rstrip())

        banner("Health check :13000")
        rc, out, err = run(client, "curl -sS -o /dev/null -w 'HTTP %{http_code} (%{time_total}s)\\n' http://127.0.0.1:13000/")
        print(out.rstrip() or "(no response)")

        banner("Last 30 lines aivedio-app log")
        rc, out, err = run(client, "docker logs --tail 30 aivedio-app 2>&1")
        print(out.rstrip())

        return 0 if exit_code == "0" else int(exit_code)
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
