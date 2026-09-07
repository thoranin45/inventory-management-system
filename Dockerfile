FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN addgroup --system appgroup \
    && adduser --system --ingroup appgroup appuser

COPY requirements.txt .

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p \
    /app/logs \
    /app/uploads \
    /app/exports \
    /app/app/static/invoices \
    /app/app/static/labels \
    /app/app/static/barcodes \
    /app/app/static/qrcodes \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8081

# Liveness only; readiness (DB + migration revision) is checked at /ready.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=3).status==200 else sys.exit(1)"]

# --proxy-headers + --forwarded-allow-ips lets Uvicorn trust the reverse
# proxy's X-Forwarded-For / X-Forwarded-Proto so request.client.host is the
# real client and request scheme is correct behind TLS termination.
# Migrations are NOT run here. They are an explicit, gated one-shot deploy
# step (see docs/deployment.md and the compose "migrate" profile).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8081", "--proxy-headers", "--forwarded-allow-ips", "*"]