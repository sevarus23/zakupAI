FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app app
COPY scripts scripts
COPY suppliers_contacts.py suppliers_contacts.py
COPY AGENTS.md AGENTS.md

ENV DATABASE_URL=postgresql+psycopg2://zakupai:zakupai@db:5432/zakupai
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
