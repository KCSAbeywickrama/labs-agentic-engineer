/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * CLI wrapper:
 *   tsx src/cli.ts record --target http://localhost:9090 --port 9091 --out ./cassettes [--match <regex>]
 *   tsx src/cli.ts serve  --dir ./cassettes [--port 9092] [--time-scale 1] [--fallback <origin-url>]
 *   tsx src/cli.ts events --file <cassette.json[.gz]> [--json] [--type <part-type>]
 */

import { parseArgs } from "node:util";
import { loadCassette } from "./cassette.js";
import { cassetteEvents, formatEvent } from "./events.js";
import { createRecordProxy } from "./record-proxy.js";
import { serveCassettes } from "./replay.js";

function usage(): never {
  console.error(
    [
      "usage:",
      "  sse-cassette record --target <origin-url> --out <dir> [--port 9091] [--match <path-regex>]",
      "  sse-cassette serve  --dir <dir> [--port 9092] [--time-scale 1] [--fallback <origin-url>]",
      "  sse-cassette events --file <cassette.json[.gz]> [--json] [--type <part-type>]",
    ].join("\n"),
  );
  process.exit(2);
}

// pnpm forwards a literal `--` separator — drop it before parsing.
const argv = process.argv.slice(2).filter((a) => a !== "--");
const [command, ...rest] = argv;

if (command === "record") {
  const { values } = parseArgs({
    args: rest,
    options: {
      target: { type: "string" },
      out: { type: "string" },
      port: { type: "string", default: "9091" },
      match: { type: "string" },
    },
  });
  if (!values.target || !values.out) usage();
  const server = createRecordProxy({
    target: values.target,
    outDir: values.out,
    ...(values.match ? { match: new RegExp(values.match) } : {}),
    log: (line) => console.log(line),
  });
  const port = Number(values.port);
  server.listen(port, () => {
    console.log(`recording proxy on http://localhost:${port} → ${values.target}`);
    console.log(`cassettes → ${values.out}${values.match ? ` (match: ${values.match})` : ""}`);
  });
} else if (command === "serve") {
  const { values } = parseArgs({
    args: rest,
    options: {
      dir: { type: "string" },
      port: { type: "string", default: "9092" },
      "time-scale": { type: "string", default: "1" },
      fallback: { type: "string" },
    },
  });
  if (!values.dir) usage();
  const dir = values.dir;
  void serveCassettes({
    dir,
    port: Number(values.port),
    timeScale: Number(values["time-scale"]),
    ...(values.fallback ? { fallbackTarget: values.fallback } : {}),
    log: (line) => console.log(line),
  }).then(({ url }) =>
    console.log(
      `replaying ${dir} on ${url}${values.fallback ? ` (fallback → ${values.fallback})` : ""}`,
    ),
  );
} else if (command === "events") {
  const { values } = parseArgs({
    args: rest,
    options: {
      file: { type: "string" },
      json: { type: "boolean", default: false },
      type: { type: "string" },
    },
  });
  if (!values.file) usage();
  const cassette = loadCassette(values.file);
  let events = cassetteEvents(cassette);
  if (values.type) events = events.filter((e) => e.type === values.type);
  if (values.json) {
    console.log(JSON.stringify(events, null, 2));
  } else {
    const body = cassette.request.body as { useCase?: string } | undefined;
    console.log(
      `${cassette.request.method} ${cassette.request.path}` +
        `${body?.useCase ? ` [${body.useCase}]` : ""} — ` +
        `${cassette.chunks.length} chunks, ${events.length} events` +
        `${values.type ? ` (type=${values.type})` : ""}\n`,
    );
    console.log(" idx    arrival  chunks    event");
    for (const e of events) console.log(formatEvent(e));
  }
} else {
  usage();
}
