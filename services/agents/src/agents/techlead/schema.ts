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
 * Tech-lead wire schema — the S2S contract with aep-api. Ported from
 * agents-legacy so the cutover from agents-legacy to this service is a URL
 * swap: aep-api's `internal/clients/agents/client.go` marshals exactly these
 * request shapes, and `internal/feature/task/task_stream.go` parses exactly the
 * plan-item / task-body response frames the routes emit (see route.ts).
 *
 * WIRE-PARITY NOTES (feed the cutover checklist):
 *  - `PlanItemSchema` field names are load-bearing: task_stream.go's
 *    `planItemFrame` reads `{tempId, componentName, title, rationale,
 *    dependsOn}`. Do NOT rename `dependsOn` — the LLM's dependsOn is
 *    context-only; aep-api derives the persisted `DependsOnComponents /
 *    DependsOnExternalResources / DependsOnResources` DIRECTLY from design.json
 *    (platform-authored, `persistAndIssue`), never from this output.
 *  - The dependency-awareness fields on `SlimDesignComponent` (external /
 *    platform-resource / org-service context) are ADDITIVE and OPTIONAL. The
 *    current aep-api client sends only `{name, componentType, language,
 *    dependsOn}` (buildPlanRequest → TechLeadSlimComponent), so it round-trips
 *    unchanged; when a future aep-api task extends the wire (the "still named
 *    DependsOn — a later task owns that contract" TODO), the planner already
 *    honors the richer context. Same additive posture as the architect `mcp`
 *    block.
 */

import { z } from "zod";

// One external-resource dependency's planning context — name + human blurb.
// The planner references these in a task's rationale to explain the
// value-collection gate; it must NOT emit a separate config-collection task
// (the platform authors those in persistAndIssue).
export const ExternalResourceContext = z.object({
  name: z.string(),
  description: z.string().optional(),
});
export type ExternalResourceContext = z.infer<typeof ExternalResourceContext>;

// One platform-resource dependency's planning context — name + resource type.
// Referenced in rationale to explain the resource-provisioning gate; the
// planner must NOT emit a resource-provisioning task (platform-authored).
export const PlatformResourceContext = z.object({
  name: z.string(),
  resourceType: z.string().optional(),
  description: z.string().optional(),
});
export type PlatformResourceContext = z.infer<typeof PlatformResourceContext>;

// One org-service (cross-project) dependency's planning context. The provider
// lives in another project, so it is never a batch `dependsOn` title; it is
// surfaced so the planner can note the cross-project binding in rationale.
export const OrgServiceContext = z.object({
  name: z.string(),
  description: z.string().optional(),
});
export type OrgServiceContext = z.infer<typeof OrgServiceContext>;

// Slim component shape passed to the planner. Mirrors the DesignComponent
// without the OpenAPI YAML payload — the planner reasons about topology and
// roles, not contracts. Detail phase gets the full design entry per task.
//
// `dependsOn` carries sibling-component (kind: "component") deps only — the
// build-order topology (aep-api's ComponentDependsOn()). The three optional
// arrays carry the OTHER unified-dependency kinds as planning context
// (additive; see the wire-parity note above).
export const SlimDesignComponent = z.object({
  name: z.string(),
  componentType: z.string(),
  language: z.string(),
  dependsOn: z.array(z.string()),
  externalResources: z.array(ExternalResourceContext).optional(),
  platformResources: z.array(PlatformResourceContext).optional(),
  orgServiceDependencies: z.array(OrgServiceContext).optional(),
});

export type SlimDesignComponent = z.infer<typeof SlimDesignComponent>;

// Existing task summary shipped to the planner so it can avoid duplicating
// already-planned work. Status is included verbatim so the model can reason
// about which tasks are real vs draft.
export const ExistingTaskSummary = z.object({
  issueNumber: z.number().int().optional(),
  title: z.string(),
  componentName: z.string(),
  status: z.string(),
});

export type ExistingTaskSummary = z.infer<typeof ExistingTaskSummary>;

// PlanItem — one row of the planner's output. The planner does NOT emit
// tempId; the route assigns "p-0", "p-1", … sequentially and pairs them with
// the seal-rule emitter (route layer). Field names are the aep-api
// `planItemFrame` contract — do not rename.
export const PlanItemSchema = z.object({
  componentName: z
    .string()
    .describe("Must match a component name in the current architecture."),
  title: z
    .string()
    .describe(
      "GitHub issue title. Must be unique within this batch (used as the dependsOn key).",
    ),
  rationale: z
    .string()
    .describe(
      "One sentence explaining why this task exists. When the component has external or platform-resource dependencies, note that the task is gated on the platform-authored value-collection / resource-provisioning of those resources.",
    ),
  dependsOn: z
    .array(z.string())
    .describe(
      "Titles of other plans in this batch this depends on (consumers list their providers). Omit titles of already-merged tasks.",
    ),
});

export type PlanItem = z.infer<typeof PlanItemSchema>;

// The full plan is a non-empty (in fresh mode) array of PlanItem.
export const PlanArraySchema = z.array(PlanItemSchema);

// Lightweight skill projection shipped to the planner — name + description
// only. The planner uses these as context for splitting tasks but does not
// load the bodies (those go to the detail phase via TechLeadDetailItem).
export const AttachedSkillSummary = z.object({
  name: z.string(),
  description: z.string(),
});
export type AttachedSkillSummary = z.infer<typeof AttachedSkillSummary>;

// Resolved skill body shipped to the tech-lead detail phase. Full SKILL.md
// content for every skill attached to the project's design. The tech-lead
// inlines these under "Skills active for this project" with "MUST consult"
// framing — there is no two-tier split at this point because the architect
// has already attached only the relevant skills.
export const ResolvedSkill = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
});
export type ResolvedSkill = z.infer<typeof ResolvedSkill>;

// Phase 1 input.
export const TechLeadPlanInput = z.object({
  projectName: z.string(),
  spec: z.string(),
  slimDesign: z.array(SlimDesignComponent),
  // Pre-formatted unified diff (BFF computes; agent only renders).
  specDiff: z.string().optional(),
  designDiff: z.string().optional(),
  existingTasks: z.array(ExistingTaskSummary).optional(),
  mode: z.enum(["fresh", "incremental"]),
  // Skills attached to this project — name + description only. The
  // planner uses these as context for splitting; bodies arrive in
  // TechLeadDetailItem.skillsResolved for the detail phase.
  attachedSkills: z.array(AttachedSkillSummary).optional(),
});

export type TechLeadPlanInput = z.infer<typeof TechLeadPlanInput>;

// Validator diff context — pre-computed by the BFF (task_diff.go) and shipped
// on the plan request so the validator's coverage rules can fire. Mirrors
// aep-api's `TechLeadValidatorDiffContext`.
export const ValidatorDiffContext = z.object({
  added: z.array(z.string()),
  contractAffectedModified: z.array(z.string()),
  removed: z.array(z.string()),
});
export type ValidatorDiffContext = z.infer<typeof ValidatorDiffContext>;

// Wire body for POST /internal/v1/agents/tech-lead/plan — the plan input plus
// the optional validator diff context (aep-api's TechLeadPlanRequest).
export const PlanRequestBody = TechLeadPlanInput.extend({
  diff: ValidatorDiffContext.optional(),
});
export type PlanRequestBody = z.infer<typeof PlanRequestBody>;

// Phase 2 input — one entry per task surviving GH issue creation.
export const TechLeadDetailItem = z.object({
  taskId: z.string().describe("Persisted DB UUID; round-tripped on the wire."),
  componentName: z.string(),
  title: z.string(),
  rationale: z.string(),
  // The component's design entry assembled from
  // `specs/design/components/<name>/{design.json,openapi.yaml}` and shipped
  // as a JSON slice for the prompt. Includes openAPISpec, appPath,
  // buildpack, etc. — the model only renders references, never inlines YAML.
  designSlice: z.string(),
  // Slim summaries (name/type/language) of dependsOn components.
  depSummaries: z.array(SlimDesignComponent),
  // Titles + status of prior tasks targeting the same component, for context.
  existingTitlesForComponent: z.array(
    z.object({ title: z.string(), status: z.string() }),
  ),
  // Full bodies of every skill attached to the project's design at
  // tech-lead detail time. The tech-lead inlines them in the user
  // prompt with "MUST consult" framing.
  skillsResolved: z.array(ResolvedSkill).optional(),
});

export type TechLeadDetailItem = z.infer<typeof TechLeadDetailItem>;

export const TechLeadDetailInput = z.object({
  projectName: z.string(),
  spec: z.string(),
  items: z.array(TechLeadDetailItem),
});

export type TechLeadDetailInput = z.infer<typeof TechLeadDetailInput>;

// Validator output — one structured issue per problem found in the plan.
export type PlanIssue = {
  tempId?: string;
  code: string;
  [key: string]: unknown;
};
