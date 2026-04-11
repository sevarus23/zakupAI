# gisp-scraper

Microservice that the zakupAI Нацрежим module (M4) calls to look up
products in the GISP PP-719v2 registry and to scrape product
characteristics from the GISP catalog.

## Why a separate service

The catalog (`gisp.gov.ru/goods/#/product/{id}`) is an Angular SPA with
no public JSON API. Pulling characteristics requires a real headless
browser. We isolate that into its own container so the main backend
stays small and so a Selenium hang can never crash the API process.

## Endpoints

| Method | Path | Cost | Description |
|--------|------|------|-------------|
| GET | `/health` | free | Liveness probe + current free browser slots |
| GET | `/pp719/{registry_number}` | ~200 ms | PP-719v2 lookup. Returns active record + actuality status |
| GET | `/catalog/{product_id}` | 8–15 s | Selenium scrape of one product card |
| GET | `/details/{registry_number}` | 8–15 s | Convenience: lookup + catalog in one call |

### `/pp719/{number}` response

```json
{
  "registry_number": "10085920",
  "status": "found_actual",
  "matched_count": 3,
  "active_record": { ...one Pp719Record... },
  "all_records":   [ ...all exact matches... ]
}
```

`status` is one of:

- `found_actual` — at least one record exactly matches and is currently in force
- `found_expired` — exact matches exist but every one is past `res_valid_till` or has `res_end_date` set
- `not_found` — nothing matched the requested digits exactly (longer numbers that contain it as a substring are filtered out)

### `/catalog/{product_id}` response

```json
{
  "product_id": "1769855",
  "url": "https://gisp.gov.ru/goods/#/product/1769855",
  "tabs_seen": ["Описание", "Технические характеристики", ...],
  "by_tab": {
    "Технические характеристики": { "Высота": "300 мм", ... }
  },
  "flat": { "Высота": "300 мм", ... },
  "warnings": []
}
```

## Configuration (env)

| Variable | Default | Description |
|----------|---------|-------------|
| `GISP_MAX_CONCURRENT` | `3` | Max simultaneous Selenium sessions |
| `PP719_HTTP_TIMEOUT` | `30` | Seconds for the registry POST |
| `CATALOG_PAGE_TIMEOUT` | `30` | Seconds to wait for the catalog SPA to render |
| `LOG_LEVEL` | `INFO` | Python logging level |

## Resource budget

One headless Chromium ≈ 250 MB peak. With `GISP_MAX_CONCURRENT=3` the
container can hit ~750 MB during heavy scraping. We set a 1 GB memory
limit on the container in `docker-compose.prod.yml`.

## Local run

```bash
docker build -t gisp-scraper .
docker run --rm -p 8000:8000 gisp-scraper
curl http://localhost:8000/pp719/10085920 | jq
curl http://localhost:8000/catalog/1769855 | jq
```
