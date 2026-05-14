FROM python:3.11-slim

WORKDIR /app

# System deps:
#  - build-essential / gcc: a few wheels still compile on first install
#  - curl: handy for healthchecks / debugging
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir emergentintegrations \
         --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ \
    || pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8002
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8002"]