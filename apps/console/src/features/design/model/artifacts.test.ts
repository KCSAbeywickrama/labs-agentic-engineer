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

import { describe, expect, it } from "vitest";
import type { DesignDependency } from "../api/designModel";
import { blockingDependencies, COMMENTS_KEY, dependencyKey, openPane } from "./artifacts";
import { designItems } from "./designFiles";

const xero: DesignDependency = {
  featureId: "F3",
  needs: "Xero",
  question: "How does Payroll export reach Xero?",
  why: "",
  options: ["Use Xero's published API"],
  answer: null,
};

const items = designItems({ "specs/design/design.cell": "title Acme\n", "specs/design/decisions.md": "# Technical decisions\n" });

describe("dependencies", () => {
  it("block only while unanswered", () => {
    expect(blockingDependencies([xero, { ...xero, featureId: "F4", answer: "We have our own contract" }])).toEqual([xero]);
  });
});

describe("what the Design card opens", () => {
  it("opens the Overview with no key, and for a key nothing has any more", () => {
    expect(openPane(items, [xero], undefined)).toEqual({ kind: "overview" });
    expect(openPane(items, [xero], "gone")).toEqual({ kind: "overview" });
  });

  it("opens every comment, a file by its key, or a blocking dependency", () => {
    expect(openPane(items, [xero], COMMENTS_KEY)).toEqual({ kind: "comments" });
    expect(openPane(items, [xero], "decisions")).toEqual({ kind: "item", item: items[1] });
    expect(openPane(items, [xero], dependencyKey("F3"))).toEqual({ kind: "blocking", dependency: xero });
  });
});
