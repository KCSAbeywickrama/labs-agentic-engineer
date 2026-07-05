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
# BUILD CONTEXT CAVEAT: docker-compose sets this service's build.context to
# services/agents (co-located with the source). This package, however, depends
# on sibling pnpm-workspace packages that live OUTSIDE that context
# (@aep/excalidraw-dsl, @aep/design-projection under packages/*). A build with
# only the service dir as context therefore cannot resolve those `workspace:*`
# deps. To build a real image, run from the repo root as context:
#
#   docker build -f services/agents/Dockerfile -t agents-service \
#     --build-context repo=. .
#
# or vendor the two packages. This is a known follow-up for the cloud image
# pipeline; local dev runs the service via `pnpm --filter @aep/agents dev`.

FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable

# Context is services/agents (see deployments/docker-compose.yml). The install
# step needs the workspace root to resolve `workspace:*` deps — see the caveat
# above.
COPY . .
RUN corepack pnpm install

USER 1000

# src/main.ts reads $PORT; compose/helm inject PORT=3400.
ENV PORT=3400
EXPOSE 3400

CMD ["corepack", "pnpm", "start"]
