FROM python:3.9-slim

RUN apt update && apt install -y libreoffice

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
