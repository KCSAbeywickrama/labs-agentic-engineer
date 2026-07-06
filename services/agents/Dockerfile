# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

# @aep/agents — interactive spec agents SSE service (Vercel AI SDK). The
# composition root at src/main.ts listens on $PORT (default 4000;
# docker-compose and the helm chart inject PORT=3400).
#
# BUILD CONTEXT: this package depends on sibling pnpm-workspace packages that
# live OUTSIDE this directory (@aep/excalidraw-dsl, @aep/design-projection
# under packages/*), so the build context is the REPO ROOT, not
# services/agents/. deployments/docker-compose.yml's agents-service sets
# `context: .. / dockerfile: services/agents/Dockerfile` accordingly. To build
# by hand, run from the repo root:
#
#   docker build -f services/agents/Dockerfile -t agents-service .
#
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable

# Manifests only first (layer caching): the workspace root plus every
# workspace member `@aep/agents` depends on via `workspace:*`, and its own
# manifest. pnpm needs each workspace member's package.json on disk to
# resolve the `--filter` graph below; source follows in the next COPY once
# deps are installed, so an install-only change doesn't invalidate it.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/excalidraw-dsl/package.json packages/excalidraw-dsl/package.json
COPY packages/design-projection/package.json packages/design-projection/package.json
COPY services/agents/package.json services/agents/package.json

RUN corepack pnpm install --filter @aep/agents...

# Now the real sources.
COPY packages/excalidraw-dsl packages/excalidraw-dsl
COPY packages/design-projection packages/design-projection
COPY services/agents services/agents

# @aep/agents itself runs from source via tsx (no build step — see CMD below),
# but its two workspace deps are consumed as COMPILED packages (each
# package.json's `main` points at `./dist/index.js`), so build them explicitly.
RUN corepack pnpm --filter @aep/excalidraw-dsl --filter @aep/design-projection run build

WORKDIR /app/services/agents
USER 1000

# src/main.ts reads $PORT; compose/helm inject PORT=3400.
ENV PORT=3400
EXPOSE 3400

CMD ["corepack", "pnpm", "start"]
