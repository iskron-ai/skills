FROM docker:27-cli AS docker-cli
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
RUN npm install --prefix /opt/probe --no-audit --no-fund opencode-ai@1.17.15
WORKDIR /verification/skills
CMD ["node", "js/tests/opencode-shell-live.mjs", "/opt/probe/node_modules/.bin/opencode"]
