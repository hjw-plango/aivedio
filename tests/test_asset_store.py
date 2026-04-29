from __future__ import annotations

from pathlib import Path


def test_store_file_writes_and_hashes(tmp_path: Path):
    from server.data.asset_store import store_file, verify

    src = tmp_path / "input.txt"
    src.write_text("hello world", encoding="utf-8")

    stored = store_file("prj_test", "shot_test", src, "first_v1.txt")
    target = Path(stored.file_path)
    assert target.exists()
    assert target.read_text(encoding="utf-8") == "hello world"
    assert len(stored.file_hash) == 64
    assert verify(stored.file_path, stored.file_hash) is True
    assert verify(stored.file_path, "0" * 64) is False
