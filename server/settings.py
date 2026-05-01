from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "aivedio"
    app_env: str = Field(default="dev")

    db_path: Path = Field(default=REPO_ROOT / "var" / "aivedio.db")
    assets_dir: Path = Field(default=REPO_ROOT / "assets")
    runs_dir: Path = Field(default=REPO_ROOT / "var" / "runs")
    configs_dir: Path = Field(default=REPO_ROOT / "configs")

    llm_base_url: str = Field(default="https://api.openai.com/v1")
    llm_api_key: str = Field(default="")
    anthropic_base_url: str = Field(default="https://api.anthropic.com")
    anthropic_api_key: str = Field(default="")
    force_mock_provider: bool = Field(default=False)

    model_research: str = Field(default="gpt-5.5")
    model_writing: str = Field(default="claude-opus-4-7")
    model_structure: str = Field(default="gpt-5.5")
    model_vision: str = Field(default="gpt-image-2")
    model_lightweight: str = Field(default="gpt-5.4-mini")

    sse_keepalive_seconds: int = 15
    request_timeout_seconds: int = 120

    def ensure_dirs(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
