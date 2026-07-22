/*
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

// Playwright reporter that reports each acceptance criterion's live status to
// the runner harness (per test begin/end) over the Unix socket named by
// AEP_CRITERION_SOCK. The harness fans it out to the live task-log stream and
// the durable store. CommonJS because tests/e2e is a CommonJS package.
//
// It is a NO-OP when AEP_CRITERION_SOCK is unset (a developer's local run) or a
// test title carries no AC id, and every send is best-effort — a delivery error
// must never fail the Playwright run.

const http = require("node:http");

// The acceptance-criterion id is the join key between a Playwright test and a
// criterion — the aep-validation skill titles each spec `test('AC-NNN-x: …')`.
// Same regex the deterministic report generator uses (references/generate-report.mjs).
const AC_ID_RE = /^(AC-\d{3}-[a-z]):/;

function acIdFromTitle(title) {
  const m = AC_ID_RE.exec(typeof title === "string" ? title : "");
  return m ? m[1] : "";
}

// Playwright result.status → the criterion status vocabulary. Anything that is
// not a clean pass or an explicit skip is a failure (timedOut / interrupted).
function mapStatus(pwStatus) {
  switch (pwStatus) {
    case "passed":
      return "passed";
    case "skipped":
      return "skipped";
    default:
      return "failed";
  }
}

function send(payload) {
  const sock = process.env.AEP_CRITERION_SOCK;
  if (!sock || !payload.criterionId) {
    return;
  }
  try {
    const body = JSON.stringify(payload);
    const req = http.request(
      { socketPath: sock, path: "/criterion", method: "POST", headers: { "Content-Type": "application/json" }, timeout: 3000 },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => {});
      },
    );
    // Best-effort: swallow every transport error so the test run is never
    // disturbed by a progress hiccup.
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.write(body);
    req.end();
  } catch {
    // ignore
  }
}

class CriterionReporter {
  onTestBegin(test) {
    send({ criterionId: acIdFromTitle(test && test.title), status: "validating" });
  }

  onTestEnd(test, result) {
    send({
      criterionId: acIdFromTitle(test && test.title),
      status: mapStatus(result && result.status),
    });
  }
}

module.exports = CriterionReporter;
module.exports.default = CriterionReporter;
// Exposed for unit tests (the reporter class itself needs Playwright to drive).
module.exports.acIdFromTitle = acIdFromTitle;
module.exports.mapStatus = mapStatus;
