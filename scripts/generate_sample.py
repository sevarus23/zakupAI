"""Generate sample_result.json for frontend demo mode.

Runs a real end-to-end flow against a local zakupAI stack:
  1. Register (or login) a demo user
  2. Create a purchase
  3. Upload TZ via doc-to-md + PATCH
  4. Wait for lots extraction
  5. Upload 3 KP bids
  6. Trigger comparison for each bid, wait for completion
  7. Trigger regime check, wait for completion
  8. Snapshot every endpoint the frontend reads, dump to
     frontend/samples/sample_result.json

Usage:
    # defaults: http://localhost/api + http://localhost/doc-to-md
    python -m scripts.generate_sample

    # custom:
    ZAKUPAI_API_URL=http://localhost:8000 \\
    ZAKUPAI_DOC_TO_MD_URL=http://localhost:8001 \\
    ZAKUPAI_SAMPLE_EMAIL=demo@zakupai.local \\
    ZAKUPAI_SAMPLE_PASSWORD=demo-pass-1234 \\
    python -m scripts.generate_sample
"""
import json
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT / "frontend" / "samples"
OUTPUT_PATH = SAMPLES_DIR / "sample_result.json"

API_URL = os.getenv("ZAKUPAI_API_URL", "http://localhost/api").rstrip("/")
DOC_TO_MD_URL = os.getenv("ZAKUPAI_DOC_TO_MD_URL", "http://localhost/doc-to-md").rstrip("/")
EMAIL = os.getenv("ZAKUPAI_SAMPLE_EMAIL", "demo-sample@zakupai.local")
PASSWORD = os.getenv("ZAKUPAI_SAMPLE_PASSWORD", "DemoSample#2026")

PURCHASE_NAME = "Демо: Оргтехника, 4 лота"

BID_FILES = [
    ("ТехноСфера", SAMPLES_DIR / "kp_1_technosfera.pdf"),
    ("ДигитСервис", SAMPLES_DIR / "kp_2_digitservice.pdf"),
    ("ИнфоТехСнаб", SAMPLES_DIR / "kp_3_infotechsnab.pdf"),
]
TZ_PATH = SAMPLES_DIR / "tz.docx"

LOTS_TIMEOUT_S = 180
COMPARE_TIMEOUT_S = 600
REGIME_TIMEOUT_S = 900
POLL_INTERVAL_S = 3


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.token: str | None = None

    def _headers(self) -> dict:
        h = {}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def request(self, method: str, path: str, **kw):
        r = requests.request(method, self.base_url + path, headers=self._headers(), timeout=60, **kw)
        if not r.ok:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:400]}")
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    def get(self, path: str):
        return self.request("GET", path)

    def post(self, path: str, json_body=None):
        return self.request("POST", path, json=json_body)

    def patch(self, path: str, json_body):
        return self.request("PATCH", path, json=json_body)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def login_or_register(client: ApiClient) -> dict:
    try:
        data = client.post("/auth/login", {"email": EMAIL, "password": PASSWORD})
        log(f"Logged in as {EMAIL}")
    except RuntimeError as e:
        if "401" in str(e) or "400" in str(e) or "invalid" in str(e).lower():
            log(f"Login failed, registering {EMAIL}")
            client.post("/auth/register", {
                "email": EMAIL,
                "password": PASSWORD,
                "full_name": "Demo Sample",
                "organization": "zakupAI Demo",
            })
            data = client.post("/auth/login", {"email": EMAIL, "password": PASSWORD})
        else:
            raise
    client.token = data["token"]
    return data["user"]


def convert_file(tz_file: Path, purchase_id: int | None, client: ApiClient) -> dict:
    with open(tz_file, "rb") as f:
        files = {"file": (tz_file.name, f, "application/octet-stream")}
        r = requests.post(
            DOC_TO_MD_URL + "/convert",
            headers=client._headers(),
            files=files,
            timeout=300,
        )
    if not r.ok:
        raise RuntimeError(f"doc-to-md /convert -> {r.status_code}: {r.text[:400]}")
    return r.json()


def wait_for_lots(client: ApiClient, purchase_id: int) -> list:
    log("Waiting for lots extraction...")
    deadline = time.time() + LOTS_TIMEOUT_S
    last_status = None
    while time.time() < deadline:
        lots_resp = client.get(f"/purchases/{purchase_id}/lots")
        status = (lots_resp or {}).get("status") if isinstance(lots_resp, dict) else None
        lots = (lots_resp or {}).get("lots") if isinstance(lots_resp, dict) else lots_resp
        if status != last_status:
            log(f"  lots status: {status} (count={len(lots) if lots else 0})")
            last_status = status
        if lots and status in ("ready", "done", "completed", "success") or (lots and len(lots) > 0 and status not in ("processing", "pending", "queued")):
            return lots
        time.sleep(POLL_INTERVAL_S)
    raise TimeoutError("Lots extraction timed out")


def wait_for_comparison(client: ApiClient, purchase_id: int, bid_ids: list[int]) -> dict:
    log("Waiting for comparison to complete for all bids...")
    deadline = time.time() + COMPARE_TIMEOUT_S
    results: dict = {}
    pending = set(bid_ids)
    while pending and time.time() < deadline:
        for bid_id in list(pending):
            try:
                resp = client.get(f"/purchases/{purchase_id}/bids/{bid_id}/comparison")
            except RuntimeError:
                continue
            status = (resp or {}).get("status") if isinstance(resp, dict) else None
            if status in ("done", "completed", "ready", "success", "failed", "error"):
                results[str(bid_id)] = resp
                pending.discard(bid_id)
                log(f"  bid {bid_id}: {status}")
        if pending:
            time.sleep(POLL_INTERVAL_S)
    if pending:
        log(f"  WARN: comparison still pending for bids {pending}")
    return results


def wait_for_regime(client: ApiClient, purchase_id: int) -> dict:
    log("Waiting for regime check to complete...")
    deadline = time.time() + REGIME_TIMEOUT_S
    while time.time() < deadline:
        prog = client.get(f"/regime/purchases/{purchase_id}/check/progress")
        status = (prog or {}).get("status") if isinstance(prog, dict) else None
        percent = (prog or {}).get("percent") if isinstance(prog, dict) else None
        log(f"  regime: status={status} percent={percent}")
        if status in ("done", "completed", "ready", "success", "failed", "error"):
            return prog
        time.sleep(POLL_INTERVAL_S)
    raise TimeoutError("Regime check timed out")


def main() -> None:
    if not TZ_PATH.exists():
        sys.exit(f"TZ not found: {TZ_PATH}")
    for _, p in BID_FILES:
        if not p.exists():
            sys.exit(f"KP not found: {p}")

    client = ApiClient(API_URL)
    user = login_or_register(client)
    log(f"User id={user.get('id')}")

    log(f"Creating purchase: {PURCHASE_NAME}")
    purchase = client.post("/purchases", {"custom_name": PURCHASE_NAME})
    purchase_id = purchase["id"]
    log(f"Purchase id={purchase_id}")

    log("Converting TZ via doc-to-md...")
    converted = convert_file(TZ_PATH, purchase_id, client)
    tz_md = converted.get("markdown", "")
    log(f"TZ markdown length: {len(tz_md)}")

    log("PATCH purchase with terms_text...")
    client.patch(f"/purchases/{purchase_id}", {"terms_text": tz_md})

    lots = wait_for_lots(client, purchase_id)
    log(f"Got {len(lots)} lots")

    log("Uploading KP bids...")
    bid_ids: list[int] = []
    for supplier_name, pdf_path in BID_FILES:
        converted = convert_file(pdf_path, purchase_id, client)
        bid_text = converted.get("markdown", "")
        bid = client.post(f"/purchases/{purchase_id}/bids", {
            "bid_text": bid_text,
            "supplier_name": supplier_name,
            "supplier_contact": None,
        })
        bid_ids.append(bid["id"])
        log(f"  KP '{supplier_name}' -> bid id={bid['id']}")

    log("Triggering comparison for each bid...")
    for bid_id in bid_ids:
        client.post(f"/purchases/{purchase_id}/bids/{bid_id}/comparison")

    comparisons = wait_for_comparison(client, purchase_id, bid_ids)

    log("Triggering regime check...")
    try:
        client.post(f"/regime/purchases/{purchase_id}/check")
    except RuntimeError as e:
        log(f"regime POST warning: {e}")
    regime_progress = wait_for_regime(client, purchase_id)

    log("Snapshotting all frontend-facing endpoints...")

    def safe(path: str):
        try:
            return client.get(path)
        except RuntimeError as e:
            log(f"  skip {path}: {e}")
            return None

    snapshot = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "purchase_id": purchase_id,
        "purchase": safe(f"/purchases/{purchase_id}"),
        "files": safe(f"/purchases/{purchase_id}/files"),
        "lots": safe(f"/purchases/{purchase_id}/lots"),
        "lots_diagnostics": safe(f"/purchases/{purchase_id}/lots/diagnostics"),
        "suppliers": safe(f"/purchases/{purchase_id}/suppliers"),
        "suppliers_search": safe(f"/purchases/{purchase_id}/suppliers/search"),
        "bids": safe(f"/purchases/{purchase_id}/bids"),
        "comparisons": comparisons,
        "comparison_diagnostics": safe(f"/purchases/{purchase_id}/comparison/diagnostics"),
        "regime_check": safe(f"/regime/purchases/{purchase_id}/check"),
        "regime_progress": regime_progress,
        "regime_diagnostics": safe(f"/regime/purchases/{purchase_id}/check/diagnostics"),
    }

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    size_kb = OUTPUT_PATH.stat().st_size // 1024
    log(f"Wrote {OUTPUT_PATH} ({size_kb} KB)")


if __name__ == "__main__":
    main()
