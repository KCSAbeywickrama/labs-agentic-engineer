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

# Stage 0: build the shared workspace packages the console reaches across the
# console-legacy/root boundary for: @aep/agent-stream and @aep/design-projection
# (console/package.json depends on both via `file:../../packages/<name>`,
# resolved relative to console-legacy/console/ — i.e. repo-root packages/<name>
# on a real checkout). Neither is a member of console-legacy's own pnpm
# workspace, and both ship `main`/`exports` pointing at a tsc-built `dist/` that
# only exists after `pnpm build` — so we install + build them from the ROOT
# workspace first, same shape as services/agents/Dockerfile's identical problem.
# Build context is the repo root (docker-compose sets `context: ..` for this
# service) so both this stage and console's own workspace below are reachable.
FROM node:22-alpine AS pkg-builder

RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile --filter @aep/agent-stream... --filter @aep/design-projection...
RUN pnpm --filter @aep/agent-stream build
RUN pnpm --filter @aep/design-projection build

# Stage 1: Build the React application, inside console-legacy's own pnpm
# workspace (console + ui-components/*) — separate from the root workspace
# above. workspace:* deps (e.g. @aep/md-editor) resolve within this workspace;
# the two file: deps resolve into pkg-builder's compiled output, copied below
# at the exact repo-root-relative path console/package.json expects.
FROM node:22-alpine AS builder

# Pin pnpm to match the local development version. The default corepack
# pnpm in node:22-alpine predates `onlyBuiltDependencies` in
# pnpm-workspace.yaml (a v10.6+ feature), so without this pin the build
# fails with ERR_PNPM_IGNORED_BUILDS for transitive scripts.
RUN corepack enable && corepack prepare pnpm@10.12.3 --activate

WORKDIR /repo

COPY --from=pkg-builder /repo/packages/agent-stream ./packages/agent-stream
COPY --from=pkg-builder /repo/packages/design-projection ./packages/design-projection

WORKDIR /repo/console-legacy

COPY console-legacy/pnpm-workspace.yaml console-legacy/pnpm-lock.yaml ./
COPY console-legacy/console/package.json ./console/
COPY console-legacy/ui-components/md-editor/package.json ./ui-components/md-editor/
COPY console-legacy/ui-components/excalidraw-editor/package.json ./ui-components/excalidraw-editor/
COPY console-legacy/ui-components/explorer/package.json ./ui-components/explorer/
COPY console-legacy/ui-components/cell-diagram-view/package.json ./ui-components/cell-diagram-view/
COPY console-legacy/ui-components/openapi-view/package.json ./ui-components/openapi-view/
COPY console-legacy/ui-components/project-status/package.json ./ui-components/project-status/
RUN pnpm install --frozen-lockfile

COPY console-legacy/console/ ./console/
COPY console-legacy/ui-components/ ./ui-components/

RUN pnpm --filter aep-console build

# Stage 2: Serve with nginx
FROM nginx:1.28-alpine

USER root

# Pull latest patched versions of CVE-flagged packages. Scoped (not blanket
# `apk upgrade`) so alpine-baselayout's pre-upgrade script doesn't try to clean
# /var/run when this image is built inside a pod that bind-mounts it read-only.
RUN apk upgrade --no-cache \
      libcrypto3 libssl3 libexpat libpng libxml2 \
      musl musl-utils nghttp2-libs zlib

RUN addgroup -g 10001 -S aepuser && \
    adduser -u 10001 -S aepuser -G aepuser

COPY --chown=10001:10001 console-legacy/console/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder --chown=10001:10001 /repo/console-legacy/console/dist /usr/share/nginx/html

COPY --chown=10001:10001 console-legacy/console/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN chown -R 10001:10001 /var/cache/nginx && \
    chown -R 10001:10001 /var/log/nginx && \
    chown -R 10001:10001 /etc/nginx && \
    chown -R 10001:10001 /usr/share/nginx/html

USER 10001

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
