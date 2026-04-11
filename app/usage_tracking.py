"""LLM/search API usage tracking.

Принцип: НИКОГДА не хардкодим цены. Берём цифры (tokens, cost) из ответа провайдера.
- OpenRouter: response.usage.prompt_tokens / completion_tokens / total_tokens,
  плюс usage.cost (приходит когда задан usage={"include": True} в extra_body) или
  usage.total_cost / cost — поля которые OpenRouter может вернуть.
- Perplexity (через OpenRouter): то же самое.
- Yandex Search API: токенов нет, считаем по запросам (request_count=1 на вызов).

Все ошибки записи проглатываются — usage tracking не должен ронять основной поток.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any, Dict, Optional

from sqlmodel import Session

from .database import engine
from .models import LLMUsage

logger = logging.getLogger(__name__)


# Контекст текущей операции — задаётся воркером перед запуском пайплайна,
# тогда суб-функции (suppliers_contacts.py) автоматически подхватят purchase_id/task_id.
_current_usage_ctx: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "_current_usage_ctx", default=None
)


def set_usage_context(ctx: Optional[Dict[str, Any]]) -> None:
    _current_usage_ctx.set(ctx)


def get_usage_context() -> Dict[str, Any]:
    ctx = _current_usage_ctx.get()
    return dict(ctx) if ctx else {}


def _extract_field(obj: Any, *names: str) -> Any:
    """Достать первое непустое поле из объекта/dict по списку имён."""
    for name in names:
        if obj is None:
            return None
        try:
            value = getattr(obj, name)
        except (AttributeError, TypeError):
            value = None
        if value is None and isinstance(obj, dict):
            value = obj.get(name)
        if value is not None:
            return value
    return None


def extract_usage_from_response(response: Any) -> dict:
    """Парсит токены/стоимость из ответа OpenAI-совместимого SDK.

    Возвращает dict с ключами prompt_tokens, completion_tokens, total_tokens, cost_usd.
    Любое поле может быть None если провайдер его не вернул.
    """
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")
    if usage is None:
        return {
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "cost_usd": None,
        }

    prompt_tokens = _extract_field(usage, "prompt_tokens", "input_tokens")
    completion_tokens = _extract_field(usage, "completion_tokens", "output_tokens")
    total_tokens = _extract_field(usage, "total_tokens")

    # OpenRouter может класть стоимость в разные поля в разных версиях
    cost_usd = _extract_field(usage, "cost", "total_cost", "cost_usd")
    # Иногда вложено: usage.cost_details.upstream_inference_cost
    if cost_usd is None:
        cost_details = _extract_field(usage, "cost_details")
        if cost_details is not None:
            cost_usd = _extract_field(
                cost_details,
                "upstream_inference_cost",
                "total_cost",
                "cost",
            )

    def _to_int(v):
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    def _to_float(v):
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "prompt_tokens": _to_int(prompt_tokens),
        "completion_tokens": _to_int(completion_tokens),
        "total_tokens": _to_int(total_tokens),
        "cost_usd": _to_float(cost_usd),
    }


def record_usage(
    *,
    channel: str,
    operation: str,
    model: Optional[str] = None,
    response: Any = None,
    purchase_id: Optional[int] = None,
    task_id: Optional[int] = None,
    user_id: Optional[int] = None,
    request_count: int = 1,
    success: bool = True,
    error_message: Optional[str] = None,
    prompt_tokens: Optional[int] = None,
    completion_tokens: Optional[int] = None,
    total_tokens: Optional[int] = None,
    cost_usd: Optional[float] = None,
) -> None:
    """Записать одну строку использования API.

    Если передан response — токены/cost будут вытащены автоматически. Можно также
    явно передать prompt_tokens/cost_usd (для случаев типа Yandex без usage в ответе).

    Никогда не выбрасывает исключение — usage tracking не должен ломать основной поток.
    """
    try:
        # Merge in any contextvar-set defaults (for callers that didn't pass purchase_id/task_id)
        ctx_defaults = get_usage_context()
        if purchase_id is None:
            purchase_id = ctx_defaults.get("purchase_id")
        if task_id is None:
            task_id = ctx_defaults.get("task_id")
        if user_id is None:
            user_id = ctx_defaults.get("user_id")

        if response is not None:
            extracted = extract_usage_from_response(response)
            if prompt_tokens is None:
                prompt_tokens = extracted["prompt_tokens"]
            if completion_tokens is None:
                completion_tokens = extracted["completion_tokens"]
            if total_tokens is None:
                total_tokens = extracted["total_tokens"]
            if cost_usd is None:
                cost_usd = extracted["cost_usd"]

        # Если total отсутствует но есть составляющие — посчитаем сами
        if total_tokens is None and (prompt_tokens or completion_tokens):
            total_tokens = (prompt_tokens or 0) + (completion_tokens or 0)

        with Session(engine) as session:
            usage_row = LLMUsage(
                channel=channel,
                operation=operation,
                model=model,
                purchase_id=purchase_id,
                task_id=task_id,
                user_id=user_id,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                cost_usd=cost_usd,
                request_count=request_count,
                success=success,
                error_message=error_message,
            )
            session.add(usage_row)
            session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[usage_tracking] failed to record %s/%s: %s",
            channel,
            operation,
            exc,
        )
