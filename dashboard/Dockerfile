# One image for both halves: the web service (default command) and the
# refresh job (deployed with `python -m app.refresh` as its command).
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY sql ./sql
COPY static ./static
COPY config.json .
COPY retention_catalog.json .

ENV PORT=8080 PYTHONUNBUFFERED=1
CMD exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --proxy-headers
