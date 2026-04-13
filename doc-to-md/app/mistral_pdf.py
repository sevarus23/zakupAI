import base64
import json
import os
import time
from pathlib import Path
from typing import Any

import requests


class MistralOcrError(RuntimeError):
    pass


def _extract_markdown_from_payload(payload: dict[str, Any]) -> str:
    pages = payload.get("pages")
    if isinstance(pages, list):
        chunks: list[str] = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            for key in ("markdown", "md", "text", "content"):
                value = page.get(key)
                if isinstance(value, str) and value.strip():
                    chunks.append(value.strip())
                    break
        if chunks:
            return "\n\n".join(chunks).strip()

    for key in ("markdown", "md", "text", "content"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    data = payload.get("data")
    if isinstance(data, dict):
        return _extract_markdown_from_payload(data)
    return ""


def run_pipeline(file_path: str, update_status, options, page_range):
    update_status("Mistral OCR pipeline started.")

    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise MistralOcrError("MISTRAL_API_KEY is not configured")

    model = os.getenv("MISTRAL_OCR_MODEL", "mistral-ocr-latest")
    base_url = os.getenv("MISTRAL_BASE_URL", "https://api.mistral.ai").rstrip("/")
    endpoint = f"{base_url}/v1/ocr"

    path = Path(file_path)
    if not path.exists():
        raise MistralOcrError("PDF file does not exist")

    page_start, page_end = page_range

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    pdf_base64 = base64.b64encode(path.read_bytes()).decode("ascii")
    payload: dict[str, Any] = {
        "model": model,
        "document": {
            "type": "document_url",
            "document_url": f"data:application/pdf;base64,{pdf_base64}",
        },
        "include_image_base64": False,
    }
    request_text = json.dumps(payload, ensure_ascii=False)

    print(
        f"[mistral-ocr] request model={model} pages={page_start}-{page_end} payload_keys={list(payload.keys())}"
    )
    print(f"[mistral-ocr] raw_request={request_text}")

    t0 = time.monotonic()
    response = requests.post(endpoint, headers=headers, json=payload, timeout=180)
    duration_ms = int((time.monotonic() - t0) * 1000)

    print(f"[mistral-ocr] status_code={response.status_code} duration_ms={duration_ms}")
    print(f"[mistral-ocr] raw_response={response.text}")

    if response.status_code >= 400:
        raise MistralOcrError(
            f"Mistral OCR request failed ({response.status_code}): {response.text[:500]}"
        )

    try:
        resp_payload = response.json()
    except Exception as exc:  # noqa: BLE001
        print(f"[mistral-ocr] json_parse_exception: {exc}")
        raise MistralOcrError(f"Invalid JSON in Mistral OCR response: {exc}") from exc

    markdown = _extract_markdown_from_payload(resp_payload)

    # Extract usage if Mistral returns it
    usage = resp_payload.get("usage") or {}
    pages_list = resp_payload.get("pages")
    pages_count = len(pages_list) if isinstance(pages_list, list) else None

    update_status("Mistral OCR pipeline completed.")
    return {
        "markdown": markdown,
        "usage": {
            "model": model,
            "duration_ms": duration_ms,
            "pages_count": pages_count,
            "prompt_tokens": usage.get("prompt_tokens") or usage.get("input_tokens"),
            "completion_tokens": usage.get("completion_tokens") or usage.get("output_tokens"),
            "total_tokens": usage.get("total_tokens"),
        },
    }
