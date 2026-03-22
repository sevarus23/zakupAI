import base64
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)


class MistralOcrError(RuntimeError):
    """Raised when OCR request to Mistral API fails."""


def _encode_file_to_data_url(file_path: str | Path, mime_type: str) -> str:
    data = Path(file_path).read_bytes()
    encoded = base64.b64encode(data).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _guess_document_type(document_value: str) -> str:
    if document_value.startswith("http://") or document_value.startswith("https://"):
        return "document_url"
    if document_value.startswith("data:"):
        return "document_url"
    return "document_url"


def build_document_payload(
    *,
    document_url: Optional[str] = None,
    local_pdf_path: Optional[str | Path] = None,
) -> Dict[str, str]:
    if document_url:
        return {"type": _guess_document_type(document_url), "document_url": document_url}

    if local_pdf_path:
        data_url = _encode_file_to_data_url(local_pdf_path, "application/pdf")
        return {"type": "document_url", "document_url": data_url}

    raise ValueError("Either document_url or local_pdf_path must be provided")


def run_mistral_ocr(
    document: Dict[str, str],
    *,
    model: str = "mistral-ocr-latest",
    table_format: Optional[str] = "html",
    extract_header: bool = False,
    extract_footer: bool = False,
    include_image_base64: bool = False,
    api_key: Optional[str] = None,
    base_url: str = "https://api.mistral.ai/v1/ocr",
    timeout_seconds: int = 180,
) -> Dict[str, Any]:
    key = api_key or os.getenv("MISTRAL_API_KEY")
    if not key:
        raise ValueError("MISTRAL_API_KEY is not set")

    payload: Dict[str, Any] = {
        "model": model,
        "document": document,
        "include_image_base64": include_image_base64,
    }
    if table_format is not None:
        payload["table_format"] = table_format
    if extract_header:
        payload["extract_header"] = True
    if extract_footer:
        payload["extract_footer"] = True

    request_text = json.dumps(payload, ensure_ascii=False)
    logger.info("Mistral OCR request payload: %s", request_text)

    response = requests.post(
        base_url,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        data=request_text.encode("utf-8"),
        timeout=timeout_seconds,
    )

    # Always log raw response text for debugging intermittent 500 errors.
    logger.info("Mistral OCR response status=%s body=%s", response.status_code, response.text)

    if response.status_code >= 400:
        raise MistralOcrError(
            f"Mistral OCR HTTP {response.status_code}. Request={request_text}. Response={response.text}"
        )

    return response.json()


def response_to_markdown(ocr_response: Dict[str, Any]) -> str:
    pages = ocr_response.get("pages") or []
    markdown_chunks = []

    for page in pages:
        markdown = page.get("markdown")
        if isinstance(markdown, str) and markdown:
            markdown_chunks.append(markdown)

    # Do not raise when markdown is empty: caller gets raw OCR response in logs.
    return "\n\n".join(markdown_chunks)
