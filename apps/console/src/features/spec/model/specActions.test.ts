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
import type { SpecFeature } from "../api/specModel";
import { specActions } from "./specActions";
import type { FeatureView } from "./workspace";

function feature(id: string, name: string, over: Partial<FeatureView> = {}): FeatureView {
  const base: SpecFeature = { id, name, path: `specs/requirements/features/${id}.md`, purpose: "", stage: "Interviewed" };
  return { ...base, chips: [], blocking: [], toConfirm: 0, designOutOfDate: false, ...over };
}

const submit = feature("F1", "Submit expenses");
const approvals = feature("F2", "Approvals");
const reports = feature("F3", "Spending reports", { stage: "Not interviewed" });
const mileage = feature("F4", "Mileage claims", { stage: "Not interviewed" });
const view = (features: FeatureView[], label: string | null, file?: string) => specActions({ features, design: { label }, file });

describe("the Spec card's step forward", () => {
  it("is the next interview while features are stubs, with Design beside it as secondary", () => {
    const v = view([submit, approvals, reports, mileage], "Design 2 features");
    expect(v.interview).toEqual({ feature: reports, primary: true });
    expect(v.design).toEqual({ label: "Design 2 features", primary: false });
  });

  it("is Design once every feature is interviewed and something waits to be designed", () => {
    expect(view([submit, approvals], "Update design · 1 feature")).toEqual({ interview: null, design: { label: "Update design · 1 feature", primary: true } });
  });

  it("offers no Design once the design has caught up", () => {
    expect(view([submit, approvals], null)).toEqual({ interview: null, design: null });
  });

  it("disables Design, saying why, before any feature is interviewed", () => {
    expect(view([reports, mileage], null).design).toEqual({ disabled: "Interview a feature first" });
  });

  it("leaves the stub's own page its Start interview as the primary", () => {
    const v = view([submit, reports, mileage], "Design 1 feature", "F3");
    expect(v.interview).toBeNull();
    expect(v.design).toEqual({ label: "Design 1 feature", primary: false });
  });

  it("skips a stub waiting on a blocking question, and yields to a page's own question", () => {
    const blocked = feature("F3", "Payroll export", { stage: "Not interviewed", blocking: [{ question: "One Xero org?", options: [] }] });
    expect(view([submit, blocked, mileage], null).interview?.feature).toBe(mileage);
    const asking = feature("F2", "Approvals", { blocking: [{ question: "Who approves?", options: [] }] });
    expect(view([submit, asking, mileage], "Design 1 feature", "F2").interview).toEqual({ feature: mileage, primary: false });
    expect(view([submit, asking], "Design 1 feature", "F2").design).toEqual({ label: "Design 1 feature", primary: false });
  });
});
