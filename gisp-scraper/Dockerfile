# GISP scraper for zakupAI Нацрежим (M4).
#
# Single-container deployment: FastAPI + Selenium + headless Chromium.
# We bake Chromium into the image so Selenium Manager doesn't have to
# download it on first run, and so we don't need a separate selenium-hub
# / node-chrome stack (which would eat ~600 MB of idle RAM we don't have).
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    # Tell Selenium where Chromium lives so it doesn't try to download chromedriver
    SE_BROWSER_PATH=/usr/bin/chromium \
    SE_DRIVER_PATH=/usr/bin/chromedriver

# Chromium + minimal libs needed for headless rendering of an Angular SPA.
# We deliberately use the Debian-packaged chromium + chromium-driver pair —
# they ship a matched version, so Selenium Manager skips its remote download.
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        chromium-driver \
        ca-certificates \
        fonts-liberation \
        fonts-dejavu-core \
        libnss3 \
        libxss1 \
        libasound2 \
        libxshmfence1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app/ ./app/

# Run as a non-root user
RUN useradd --create-home --shell /bin/bash scraper \
    && chown -R scraper:scraper /app
USER scraper

EXPOSE 8000

# A single uvicorn worker is enough — concurrency is bounded by GISP_MAX_CONCURRENT
# inside the app, and we don't want N workers each spawning their own Chromium pool.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
