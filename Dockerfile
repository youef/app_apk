# Render Docker build from the repository root.
# If Render Root Directory=python-cloud-studio, use that folder's Dockerfile.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ALEZZ_PUBLIC_MODE=1
WORKDIR /app
COPY python-cloud-studio/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY python-cloud-studio/ ./
EXPOSE 8080
# Cloud auth deliberately fails startup unless ALEZZ_SITE_PASSWORD (12+ chars)
# and ALEZZ_SITE_SECRET (32+ chars) are set in Render's secret env vars.
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
