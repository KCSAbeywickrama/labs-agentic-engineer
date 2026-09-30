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
import type { ProductWideItem, SpecFeature } from "../api/specModel";
import { designBasis, designLabel, designWork } from "./designWork";
import type { LineBlock } from "./ids";

const li = (text: string, emphasis: LineBlock["emphasis"] = []): LineBlock => ({ kind: "listItem", text, emphasis });
const h1 = (text: string): LineBlock => ({ kind: "heading", level: 1, text, emphasis: [] });

const F1_PATH = "requirements/features/F1.md";
const F2_PATH = "requirements/features/F2.md";
const PW_PATH = "requirements/product-wide.md";

function feature(id: string, over: Partial<SpecFeature> = {}): SpecFeature {
  return { id, name: id, path: `requirements/features/${id}.md`, purpose: "", stage: "Interviewed", blocking: null, ...over };
}

const assumedLine = "F2.4 A deputy approves in my place. assumed";
const assumedTag = { start: assumedLine.indexOf("assumed"), end: assumedLine.length };

function spec(over: Record<string, LineBlock[]> = {}): Map<string, LineBlock[]> {
  return new Map(
    Object.entries({
      [F1_PATH]: [h1("Submit expenses"), li("F1.1 I photograph a receipt.")],
      [F2_PATH]: [h1("Approvals"), li("F2.2 I approve with a reason."), li(assumedLine, [assumedTag])],
      [PW_PATH]: [h1("Product-wide"), li("P1 Every approval is logged."), li("P3 Amounts are in cents.")],
      ...over,
    }),
  );
}

const productWide: ProductWideItem[] = [
  { id: "P1", appliesTo: "all" },
  { id: "P3", appliesTo: ["F1"] },
];

const f1 = feature("F1");
const f2 = feature("F2");

describe("designBasis", () => {
  it("reads the feature's lines and only the product-wide items that reach it", () => {
    expect(designBasis(f2, spec(), productWide)).toBe(
      "Approvals\nF2.2 I approve with a reason.\nF2.4 A deputy approves in my place.\nP1 Every approval is logged.",
    );
    expect(designBasis(f1, spec(), productWide)).toContain("P3 Amounts are in cents.");
  });

  it("does not move when an assumed line is confirmed", () => {
    const confirmed = spec({ [F2_PATH]: [h1("Approvals"), li("F2.2 I approve with a reason."), li("F2.4 A deputy approves in my place.")] });
    expect(designBasis(f2, confirmed, productWide)).toBe(designBasis(f2, spec(), productWide));
  });

  it("leaves out a pending proposal's lines", () => {
    const pending = spec({
      [F2_PATH]: [...spec().get(F2_PATH)!, { ...li("F2.6 As an auditor, I see every decision."), proposed: true }],
    });
    expect(designBasis(f2, pending, productWide)).toBe(designBasis(f2, spec(), productWide));
  });
});

describe("designWork", () => {
  const designedFrom = { F1: designBasis(f1, spec(), productWide), F2: designBasis(f2, spec(), productWide) };

  it("takes every interviewed, unblocked feature not designed yet", () => {
    const blocked = feature("F3", { blocking: { question: "One Xero organisation?", why: "", options: [] } });
    const stub = feature("F4", { stage: "Not interviewed" });
    expect(designWork([f1, f2, blocked, stub], {}, spec(), productWide)).toEqual({ toDesign: ["F1", "F2"], outOfDate: [] });
  });

  it("has nothing to do while the spec reads as it was designed", () => {
    expect(designWork([f1, f2], designedFrom, spec(), productWide)).toEqual({ toDesign: [], outOfDate: [] });
  });

  it("puts a feature out of date when a line of its spec changes, and only that feature", () => {
    const edited = spec({ [F2_PATH]: [h1("Approvals"), li("F2.2 I approve or reject with a reason."), li(assumedLine, [assumedTag])] });
    expect(designWork([f1, f2], designedFrom, edited, productWide)).toEqual({ toDesign: ["F2"], outOfDate: ["F2"] });
  });

  it("puts every feature a new product-wide item applies to out of date", () => {
    const withP5 = spec({ [PW_PATH]: [...spec().get(PW_PATH)!, li("P5 An auditor reads everything.")] });
    const reach: ProductWideItem[] = [...productWide, { id: "P5", appliesTo: ["F2", "F3"] }];
    expect(designWork([f1, f2], designedFrom, withP5, reach).outOfDate).toEqual(["F2"]);
    const everywhere: ProductWideItem[] = [...productWide, { id: "P5", appliesTo: "all" }];
    expect(designWork([f1, f2], designedFrom, withP5, everywhere).outOfDate).toEqual(["F1", "F2"]);
  });
});

describe("designLabel", () => {
  it("designs while any feature is new to design, and updates when all were designed", () => {
    expect(designLabel(["F1", "F2"], {})).toBe("Design 2 features");
    expect(designLabel(["F2", "F3"], { F2: "x" })).toBe("Design 2 features");
    expect(designLabel(["F2"], { F2: "x" })).toBe("Update design · 1 feature");
    expect(designLabel([], { F2: "x" })).toBeNull();
  });
});
