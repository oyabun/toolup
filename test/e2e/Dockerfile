# A clean machine with the real agent CLIs, to run the installer for real.
# Build from the repo root:  docker build -f test/e2e/Dockerfile -t kitem-e2e .   then:  docker run --rm kitem-e2e
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 curl git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
RUN useradd -m kit
USER kit
WORKDIR /home/kit/kitem
COPY --chown=kit public/install.sh public/catalog.tsv ./public/
COPY --chown=kit test/e2e/run.sh ./test/e2e/run.sh
# Cursor is an app, not a CLI: its presence is ~/.cursor, and its servers are merged into ~/.cursor/mcp.json.
RUN mkdir -p /home/kit/.cursor
ENV CATALOG_URL=file:///home/kit/kitem/public/catalog.tsv NO_COLOR=1
CMD ["bash", "test/e2e/run.sh"]
