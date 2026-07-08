#!/bin/sh
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
