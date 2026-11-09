FROM python:3.13-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ALEZZ_PUBLIC_MODE=1 ALEZZ_BROWSER_CAPTURE=1 \
    ALEZZ_AUTOSYNC_ENABLED=1 ALEZZ_AUTOSYNC_MODE=auto ALEZZ_AUTOSYNC_INTERVAL_HOURS=24 \
    ALEZZ_AUTOSYNC_CONCURRENCY=5
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Install Playwright's headless Chromium browser plus required Linux libraries.
RUN python -m playwright install --with-deps --only-shell chromium
COPY . .
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
