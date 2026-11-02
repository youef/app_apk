# Render Web Service fallback: builds from the repository root.
# For services with Root Directory=python-cloud-studio, use the existing
# python-cloud-studio/Dockerfile instead.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY python-cloud-studio/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY python-cloud-studio/ ./
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
