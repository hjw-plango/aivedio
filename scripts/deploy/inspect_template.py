"""Inspect persisted compatMediaTemplate for gpt-image-2 to see if outputBase64Path is set."""
from __future__ import annotations
import os, sys, json
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass
import paramiko  # type: ignore[import-untyped]


SQL = (
    "SELECT customModels FROM user_preferences "
    "WHERE customModels LIKE '%gpt-image-2%' OR customModels LIKE '%mou6foi5%' LIMIT 1;"
)


def main() -> int:
    host = os.environ["SSH_HOST"]; user = os.environ["SSH_USER"]; pwd = os.environ["SSH_PASSWORD"]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=pwd, timeout=15, allow_agent=False, look_for_keys=False)
    try:
        # Read MYSQL_ROOT_PASSWORD from .env.server (we redacted earlier; need actual)
        cmd_pwd = "grep '^MYSQL_ROOT_PASSWORD=' /home/ubuntu/aivedio/.env.server | cut -d= -f2-"
        _, o, _ = client.exec_command(cmd_pwd, timeout=10)
        mysql_pwd = o.read().decode("utf-8").strip()
        if not mysql_pwd:
            print("ERROR: cannot read MYSQL_ROOT_PASSWORD")
            return 2

        # Query through docker exec
        cmd = (
            f"docker exec aivedio-mysql mysql -uroot -p'{mysql_pwd}' "
            f"-D waoowaoo -N -e \"{SQL}\" 2>/dev/null"
        )
        _, o, e = client.exec_command(cmd, timeout=20)
        out = o.read().decode("utf-8", errors="replace")
        err = e.read().decode("utf-8", errors="replace")
        if err.strip():
            print(f"[stderr] {err.rstrip()}")
        if not out.strip():
            print("(no row matched — the customModels field may be empty)")
            return 0

        # First column = customModels JSON. Tabs separate columns.
        raw = out.strip().split("\t")[0]
        # mysql -N may return long row on one line
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"[parse] failed: {exc}")
            print(f"[raw first 500] {raw[:500]}")
            return 1

        print(f"[parse] customModels has {len(data)} entries")
        # Find the gpt-image-2 entry
        match = None
        for entry in data:
            if isinstance(entry, dict):
                provider = str(entry.get("providerId") or entry.get("provider") or "")
                model_id = str(entry.get("modelId") or entry.get("id") or "")
                if "gpt-image-2" in model_id or "gpt-image-2" in provider:
                    match = entry
                    break
        if not match:
            print("[search] no gpt-image-2 entry found — listing all model ids:")
            for entry in data:
                if isinstance(entry, dict):
                    print(f"  - providerId={entry.get('providerId')} modelId={entry.get('modelId')}")
            return 0

        print("\n========== Persisted entry for gpt-image-2 ==========")
        # Truncate any very long fields
        def trunc(v):
            if isinstance(v, str) and len(v) > 300: return v[:300] + f"...<{len(v)}>"
            return v
        print(json.dumps({k: trunc(v) for k, v in match.items()}, ensure_ascii=False, indent=2))

        # Specifically the response map
        tpl = match.get("compatMediaTemplate")
        if not tpl:
            print("\n[result] NO compatMediaTemplate persisted on this entry.")
            return 0
        resp = (tpl or {}).get("response") or {}
        print("\n========== compatMediaTemplate.response ==========")
        print(json.dumps(resp, ensure_ascii=False, indent=2))
        print(f"\noutputBase64Path present? {'YES' if resp.get('outputBase64Path') else 'NO'}")
        print(f"outputUrlPath present?    {'YES' if resp.get('outputUrlPath') else 'NO'}")
        print(f"outputUrlsPath present?   {'YES' if resp.get('outputUrlsPath') else 'NO'}")

    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
