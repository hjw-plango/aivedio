"""One-shot DB initialization. Run with: python -m server.data.init_db"""

from __future__ import annotations

from server.data.session import init_db
from server.settings import get_settings


def main() -> None:
    settings = get_settings()
    settings.ensure_dirs()
    init_db()
    print(f"db ready at {settings.db_path}")


if __name__ == "__main__":
    main()
