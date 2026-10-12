#!/bin/sh
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

# The entrypoint of a runner container started on a Linux host: the
# playground's docker-mode coding run and run-local.sh both bind-mount it over
# the unmodified runner image; it is never baked into the image.
#
# The image runs as `aep` (uid 999). On a Linux host a bind mount keeps the
# host's numeric owners, so uid 999 cannot write the directories the host user
# mounts in, and what it does write the host user cannot delete. macOS
# (Docker Desktop, colima) maps a mount's owner to the host user, so this is
# not used there.
#
# The container starts as root only for this step: `aep` takes the host user's
# uid and gid (usermod re-owns /home/aep: about 3 s on the Claude Code image,
# about 35 s on the OpenCode one, whose home holds its prewarmed caches), and
# the run then drops to `aep` and goes through the image's own entrypoint, so
# the rlimits it sets still apply. HOME stays /home/aep, as in a pod. When an
# image user already had the host uid (node:22's `node` is 1000), a lookup of
# the uid names that user; the runner reads HOME, never the name.
set -eu

: "${AEP_HOST_UID:?AEP_HOST_UID is not set}"
: "${AEP_HOST_GID:?AEP_HOST_GID is not set}"

if [ "$(id -u aep)" != "$AEP_HOST_UID" ] || [ "$(id -g aep)" != "$AEP_HOST_GID" ]; then
  # -o: the image can already have the id (node:22 ships `node` as 1000:1000).
  groupmod -o -g "$AEP_HOST_GID" aep
  usermod -o -u "$AEP_HOST_UID" -g "$AEP_HOST_GID" aep
fi

export HOME=/home/aep USER=aep LOGNAME=aep
exec setpriv --reuid=aep --regid=aep --init-groups /usr/local/bin/aep-runner-entrypoint "$@"
