"""ModelRouter: unified entry for LLM calls.

Agents must not bind to specific models. They pass a task_type, prompt and
context and the router picks model + provider from settings. All calls are
recorded in model_calls.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Protocol

from server.data.models import ModelCall
from server.data.session import session_scope
from server.settings import get_settings
from server.utils.ids import new_id


TaskType = Literal["research", "writing", "structure", "vision", "lightweight"]


@dataclass
class CallResult:
    text: str
    model: str
    task_type: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    raw: dict[str, Any] = field(default_factory=dict)
    cross_check: "CallResult | None" = None


class Provider(Protocol):
    """Minimal interface a model provider must implement."""

    def complete(
        self,
        model: str,
        prompt: str,
        context: dict[str, Any] | None = None,
        timeout: int = 120,
    ) -> CallResult: ...


class MockProvider:
    """Deterministic provider for tests and offline runs.

    Returns a fixed string composed from model and prompt so tests can assert.
    """

    def complete(
        self,
        model: str,
        prompt: str,
        context: dict[str, Any] | None = None,
        timeout: int = 120,
    ) -> CallResult:
        text = f"[mock:{model}] {prompt[:120]}"
        return CallResult(
            text=text,
            model=model,
            task_type="mock",
            input_tokens=len(prompt) // 4,
            output_tokens=len(text) // 4,
            latency_ms=0,
            raw={"mock": True, "context_keys": list((context or {}).keys())},
        )


class OpenAICompatibleProvider:
    """OpenAI-compatible chat completion provider.

    Works with the official OpenAI endpoint and most relay/router stations.
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self.api_key = api_key

    def complete(
        self,
        model: str,
        prompt: str,
        context: dict[str, Any] | None = None,
        timeout: int = 120,
    ) -> CallResult:
        from openai import OpenAI

        client = OpenAI(base_url=self.base_url, api_key=self.api_key, timeout=timeout)
        messages: list[dict[str, str]] = []
        if context and context.get("system"):
            messages.append({"role": "system", "content": str(context["system"])})
        messages.append({"role": "user", "content": prompt})
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=context.get("temperature", 0.7) if context else 0.7,
        )
        choice = response.choices[0]
        text = choice.message.content or ""
        usage = response.usage
        return CallResult(
            text=text,
            model=model,
            task_type="openai_compatible",
            input_tokens=getattr(usage, "prompt_tokens", 0) if usage else 0,
            output_tokens=getattr(usage, "completion_tokens", 0) if usage else 0,
            latency_ms=0,
            raw={"finish_reason": choice.finish_reason},
        )


class AnthropicProvider:
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self.api_key = api_key

    def complete(
        self,
        model: str,
        prompt: str,
        context: dict[str, Any] | None = None,
        timeout: int = 120,
    ) -> CallResult:
        from anthropic import Anthropic

        client = Anthropic(base_url=self.base_url, api_key=self.api_key, timeout=timeout)
        system = (context or {}).get("system")
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": (context or {}).get("max_tokens", 4096),
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = str(system)
        response = client.messages.create(**kwargs)
        text_parts = [
            block.text for block in response.content if getattr(block, "type", None) == "text"
        ]
        text = "".join(text_parts)
        return CallResult(
            text=text,
            model=model,
            task_type="anthropic",
            input_tokens=response.usage.input_tokens if response.usage else 0,
            output_tokens=response.usage.output_tokens if response.usage else 0,
            latency_ms=0,
            raw={"stop_reason": response.stop_reason},
        )


class ModelRouter:
    """Route tasks to (provider, model) pairs.

    Cross-check: when cross_check=True, run secondary model in parallel-style
    and attach its result. Caller decides how to combine.
    """

    def __init__(
        self,
        primary: Provider | None = None,
        secondary: Provider | None = None,
    ) -> None:
        self._primary = primary
        self._secondary = secondary

    @classmethod
    def from_settings(cls) -> "ModelRouter":
        settings = get_settings()
        primary: Provider
        secondary: Provider
        if settings.llm_api_key:
            primary = OpenAICompatibleProvider(settings.llm_base_url, settings.llm_api_key)
        else:
            primary = MockProvider()
        if settings.anthropic_api_key:
            secondary = AnthropicProvider(settings.anthropic_base_url, settings.anthropic_api_key)
        else:
            secondary = MockProvider()
        return cls(primary=primary, secondary=secondary)

    def _model_for(self, task_type: str) -> tuple[Provider, str]:
        settings = get_settings()
        mapping: dict[str, tuple[Provider | None, str]] = {
            "research": (self._primary, settings.model_research),
            "structure": (self._primary, settings.model_structure),
            "writing": (self._secondary, settings.model_writing),
            "vision": (self._primary, settings.model_vision),
            "lightweight": (self._primary, settings.model_lightweight),
        }
        provider, model = mapping.get(task_type, (self._primary, settings.model_structure))
        if provider is None:
            provider = MockProvider()
        return provider, model

    def call(
        self,
        task_type: TaskType,
        prompt: str,
        context: dict[str, Any] | None = None,
        cross_check: bool = False,
        step_id: str | None = None,
    ) -> CallResult:
        provider, model = self._model_for(task_type)
        result = self._invoke(provider, model, task_type, prompt, context, step_id)
        if cross_check:
            cross_provider = self._secondary or MockProvider()
            cross_model = get_settings().model_writing
            result.cross_check = self._invoke(
                cross_provider, cross_model, f"{task_type}_xcheck", prompt, context, step_id
            )
        return result

    def _invoke(
        self,
        provider: Provider,
        model: str,
        task_type: str,
        prompt: str,
        context: dict[str, Any] | None,
        step_id: str | None,
    ) -> CallResult:
        timeout = get_settings().request_timeout_seconds
        started = time.perf_counter()
        status = "ok"
        error: str | None = None
        try:
            result = provider.complete(model, prompt, context, timeout)
            result.task_type = task_type
            result.latency_ms = int((time.perf_counter() - started) * 1000)
            return result
        except Exception as exc:
            status = "error"
            error = str(exc)
            raise
        finally:
            self._record(
                step_id=step_id,
                task_type=task_type,
                model=model,
                latency_ms=int((time.perf_counter() - started) * 1000),
                status=status,
                error=error,
            )

    def _record(
        self,
        step_id: str | None,
        task_type: str,
        model: str,
        latency_ms: int,
        status: str,
        error: str | None,
    ) -> None:
        try:
            with session_scope() as session:
                session.add(
                    ModelCall(
                        id=new_id("mc"),
                        step_id=step_id,
                        task_type=task_type,
                        model=model,
                        latency_ms=latency_ms,
                        status=status,
                        error=error,
                        created_at=datetime.now(timezone.utc),
                    )
                )
        except Exception:
            pass
