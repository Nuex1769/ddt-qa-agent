from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    demo_mode: bool = True
    database_url: str = f"sqlite:///{ROOT / 'data' / 'ddt.db'}"
    session_secret: str = "local-development-change-before-deployment"
    cookie_secure: bool = False
    allowed_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"
    )
    admin_username: str = "admin"
    admin_password: str = ""
    model_base_url: str = ""
    model_api_key: str = ""
    chat_model: str = ""
    chat_thinking: Literal["auto", "enabled", "disabled"] = "auto"
    retrieval_mode: Literal["keyword", "hybrid"] = "hybrid"
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    embedding_dimensions: int = 1536
    top_k: int = 5
    max_upload_mb: int = 20

    @model_validator(mode="after")
    def validate_production(self):
        if self.database_url.startswith("sqlite:///./"):
            self.database_url = "sqlite:///" + str(ROOT / self.database_url.removeprefix("sqlite:///./"))
        if not 1 <= self.top_k <= 20 or not 1 <= self.max_upload_mb <= 100:
            raise ValueError("TOP_K 必须为 1–20，MAX_UPLOAD_MB 必须为 1–100")
        if not 1 <= self.embedding_dimensions <= 2000:
            raise ValueError("EMBEDDING_DIMENSIONS 必须为 1–2000")
        if not self.demo_mode:
            if len(self.session_secret) < 32 or self.session_secret.startswith("local-"):
                raise ValueError("真实环境必须设置至少 32 位随机 SESSION_SECRET")
            if len(self.admin_password) < 12:
                raise ValueError("真实环境必须设置至少 12 位 ADMIN_PASSWORD")
            if not all([self.model_base_url, self.model_api_key, self.chat_model]):
                raise ValueError("真实环境必须配置 MODEL_BASE_URL、MODEL_API_KEY 和 CHAT_MODEL")
            if self.vector_enabled:
                if not self.embedding_base_url and self.is_deepseek:
                    raise ValueError(
                        "DeepSeek 官方聊天接口不能作为向量服务，请设置 RETRIEVAL_MODE=keyword，"
                        "或独立配置 EMBEDDING_BASE_URL、EMBEDDING_API_KEY 和 EMBEDDING_MODEL"
                    )
                if not all([self.vector_base_url, self.vector_api_key, self.embedding_model]):
                    raise ValueError(
                        "混合检索需要 Embedding 地址、密钥和模型；不同地址必须设置独立的 "
                        "EMBEDDING_API_KEY，或改用 RETRIEVAL_MODE=keyword"
                    )
        return self

    @property
    def is_deepseek(self) -> bool:
        return urlsplit(self.model_base_url).hostname == "api.deepseek.com"

    @property
    def vector_enabled(self) -> bool:
        return not self.demo_mode and self.retrieval_mode == "hybrid"

    @property
    def vector_base_url(self) -> str:
        return (self.embedding_base_url or self.model_base_url).rstrip("/")

    @property
    def vector_api_key(self) -> str:
        if self.embedding_api_key:
            return self.embedding_api_key
        # Never forward the chat credential to a separately configured service.
        if self.vector_base_url == self.model_base_url.rstrip("/"):
            return self.model_api_key
        return ""

    @property
    def thinking_options(self) -> dict:
        if self.chat_thinking == "auto":
            return {"thinking": {"type": "disabled"}} if self.is_deepseek else {}
        return {"thinking": {"type": self.chat_thinking}}

    @property
    def origins(self) -> list[str]:
        return [x.strip().rstrip("/") for x in self.allowed_origins.split(",") if x.strip()]


settings = Settings()
