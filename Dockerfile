# Render Docker build from the repository root.
# If Render Root Directory=python-cloud-studio, use that folder's Dockerfile.
FROM python:3.13-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ALEZZ_PUBLIC_MODE=1 ALEZZ_BROWSER_CAPTURE=1 \
    ALEZZ_AUTOSYNC_ENABLED=1 ALEZZ_AUTOSYNC_MODE=auto ALEZZ_AUTOSYNC_INTERVAL_HOURS=24 \
    ALEZZ_AUTOSYNC_CONCURRENCY=5
WORKDIR /app
COPY python-cloud-studio/requirements.txt ./requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*\nRUN pip install --no-cache-dir -r requirements.txt
# Install Playwright's headless Chromium browser plus required Linux libraries.
RUN python -m playwright install --with-deps --only-shell chromium
COPY python-cloud-studio/ ./
COPY web/ /app/portal/web/
COPY admin/ /app/portal/admin/
ENV ALEZZ_PORTAL_DIR=/app/portal
EXPOSE 8080
# Cloud auth deliberately fails startup unless ALEZZ_SITE_PASSWORD (12+ chars)
# and ALEZZ_SITE_SECRET (32+ chars) are set in Render's secret env vars.
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
