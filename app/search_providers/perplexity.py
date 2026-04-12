"""Perplexity-backed supplier search.

Perplexity is reached through OpenRouter via the unified ``llm`` transport
under the dedicated task name ``supplier_search_perplexity``. The model is
overridable via ``LLM_MODEL_SUPPLIER_SEARCH_PERPLEXITY`` (or the legacy
``PERPLEXITY_MODEL`` env var).
"""
import os
from typing import Any, Dict, Optional

from app.services import llm
from app.services.llm_tasks import extract_structured_contacts_from_perplexity

# Task name — must match the suffix used for env-var overrides.
TASK_SUPPLIER_SEARCH_PERPLEXITY = "supplier_search_perplexity"


def _build_prompt(terms_text: str, min_contacts: int) -> str:
    return (
        "Найди поставщиков и их веб-сайты "
        f"(не менее {min_contacts}) для следующей закупки:\n"
        f"{terms_text}"
    )


def _resolve_min_contacts() -> int:
    raw = (os.getenv("PERPLEXITY_MIN_CONTACTS") or "").strip()
    try:
        return int(raw) if raw else 10
    except ValueError:
        return 10


def _resolve_perplexity_model() -> str:
    """Pick the Perplexity model.

    Allow either the new task-scoped override or the legacy ``PERPLEXITY_MODEL``
    env var. When neither is set, fall back to the default sonar model.
    """
    legacy = os.getenv("PERPLEXITY_MODEL")
    if legacy:
        os.environ.setdefault("LLM_MODEL_SUPPLIER_SEARCH_PERPLEXITY", legacy)
    return llm.resolve_config(TASK_SUPPLIER_SEARCH_PERPLEXITY).model


def search_suppliers_with_perplexity(
    terms_text: str,
    *,
    usage_ctx: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    min_contacts = _resolve_min_contacts()
    prompt = _build_prompt(terms_text or "", min_contacts)
    model = _resolve_perplexity_model()

    response = llm.chat_completion(
        [{"role": "user", "content": prompt}],
        task=TASK_SUPPLIER_SEARCH_PERPLEXITY,
        extra_body={"reasoning": {"enabled": True}},
        timeout=120.0,
        usage_ctx=usage_ctx,
    )

    content = response.choices[0].message.content if response.choices else None
    if not content:
        raise RuntimeError("Empty response from Perplexity")

    structured = extract_structured_contacts_from_perplexity(content, terms_text, usage_ctx=usage_ctx)
    return {
        "queries": [prompt],
        "tech_task_excerpt": (terms_text or "")[:160],
        "note": f"Поиск выполнен через Perplexity ({model})",
        "raw_response": content,
        "search_output": structured.get("search_output", []),
        "processed_contacts": [],
    }
