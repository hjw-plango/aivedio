"""Inspect recent task statuses + look for any errors during generation."""
from __future__ import annotations
import os, sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass
import paramiko  # type: ignore[import-untyped]


def main() -> int:
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(hostname=host, username=user, password=pwd, timeout=15, allow_agent=False, look_for_keys=False)
    try:
        # Read MYSQL_ROOT_PASSWORD and write a small SQL file remotely to avoid quoting
        _, o, _ = c.exec_command(
            "grep '^MYSQL_ROOT_PASSWORD=' /home/ubuntu/aivedio/.env.server | cut -d= -f2-",
            timeout=10,
        )
        mysql_pwd = o.read().decode("utf-8", errors="replace").strip()
        if not mysql_pwd:
            print("ERROR: MYSQL_ROOT_PASSWORD not found")
            return 2

        # Write SQL to a tmp file inside the mysql container, then exec
        sql = (
            "DESCRIBE tasks;\n"
            "SELECT * FROM tasks "
            "WHERE updatedAt >= DATE_SUB(NOW(), INTERVAL 60 MINUTE) "
            "ORDER BY updatedAt DESC LIMIT 5\\G"
        )
        # Encode as base64 to avoid shell quoting hell
        import base64
        sql_b64 = base64.b64encode(sql.encode()).decode()
        cmd = (
            f"echo '{sql_b64}' | base64 -d > /tmp/q.sql && "
            f"docker cp /tmp/q.sql aivedio-mysql:/tmp/q.sql && "
            f"docker exec aivedio-mysql sh -c "
            f"'mysql -uroot -p{mysql_pwd} -D waoowaoo < /tmp/q.sql' 2>&1"
        )
        _, o, e = c.exec_command(cmd, timeout=20)
        print(o.read().decode("utf-8", errors="replace"))
        err = e.read().decode("utf-8", errors="replace")
        if err.strip():
            print("STDERR:", err)
    finally:
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
