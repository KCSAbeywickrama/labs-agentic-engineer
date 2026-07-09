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

# NEW file-mutation agents service (services/agents). Built from the REPO ROOT
# context (docker-compose sets `context: ..`) because @aep/agents imports the
# workspace package @aep/agent-stream — pnpm must see the whole workspace to
# resolve it. (@aep/excalidraw-dsl and @aep/design-projection are devDependencies
# used only by the playground/evals, never by src/main.ts, so the running service
# needs neither installed nor built.)
FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /repo

# Workspace manifests first for install-layer caching. tsconfig.base.json is the
# shared base @aep/agent-stream's tsconfig extends — needed for the tsc build below.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
# The agents package plus the workspace packages it depends on.
COPY packages ./packages
COPY services/agents ./services/agents

# Install @aep/agents + its workspace deps. This also installs the workspace ROOT
# project's devDependencies (pnpm always installs the root's deps) — so `typescript`
# is present to compile @aep/agent-stream in the next step. (@types/node and tsx
# ride in via @aep/agents' own dependencies.)
RUN pnpm install --frozen-lockfile --filter @aep/agents...

# @aep/agents runs from TypeScript source via tsx (no build of its own), but it
# imports @aep/agent-stream and @aep/collab-doc as packages whose `exports`
# resolve to ./dist — both MUST be compiled before the service can start.
# Without this step the container crashes at boot with "Cannot find module
# .../@aep/agent-stream/dist" (or the collab-doc analog).
RUN pnpm --filter @aep/agent-stream build && pnpm --filter @aep/collab-doc build

WORKDIR /repo/services/agents

USER 1000
EXPOSE 4000
# The service listens on PORT (default 4000) and serves GET /healthz.
CMD ["pnpm", "start"]
