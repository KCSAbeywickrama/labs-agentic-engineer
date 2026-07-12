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

# Generates /env-config.js from VITE_* environment variables so the SPA can
# read runtime config via window._env_ without baking values into the bundle.
# Runs as part of the nginx Docker entrypoint (docker-entrypoint.d/ ordering).
set -e

outfile=/usr/share/nginx/html/env-config.js

printf 'window._env_ = {\n' > "$outfile"
env | grep '^VITE_' | sort | while IFS='=' read -r key value; do
    printf '  "%s": "%s",\n' "$key" "$value" >> "$outfile"
done
printf '};\n' >> "$outfile"
