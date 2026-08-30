FROM node:22.23.2-bookworm

WORKDIR /app

# The API calls the curve and hypertension predictors through Python.
# Install into an isolated venv so the Node base image's system Python remains untouched.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        python3-venv \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir --upgrade pip \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/venv/bin:${PATH}"

COPY ml/requirements*.txt ./ml/
RUN python -m pip install --no-cache-dir -r ./ml/requirements.txt

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev --build-from-source

COPY . .

WORKDIR /app/server

ENV PORT=3001
ENV PYTHON_SERVICE_URL=http://127.0.0.1:8765
ENV PYTHON_CLI_FALLBACK=1
EXPOSE 3001

RUN chmod +x /app/scripts/start-container.sh
CMD ["/app/scripts/start-container.sh"]
