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

import type { Proposal, SpecModel } from "../../features/spec/api/specModel";

// PROVISIONAL — mock-only until S3; see features/spec/api/specModel.ts.
//
// Acme Expenses three weeks in: three features interviewed, two stubs. The
// markdown follows skills/prd-contract (sections, the literal `*assumed*` tag,
// permanent story numbers) and the spec model: prd.md is the product page,
// each feature has its own file with `F<n>.<m>` stories, product-wide.md
// holds the `P<n>` items. F2.3 moved to Mileage claims and now reads
// "F5.1 (was F2.3)"; F2's out-of-scope line still names the old ID.
//
// The agent has one change waiting for the user: an Auditor who can read
// everything, which touches the Actors, Approvals, Payroll export and
// product-wide, and takes the auditors' idea out of the Fog.

const POLICY = "T&E policy";

const acmePrd = `# Acme Expenses

## Problem Statement

Acme's 40 staff claim expenses on paper forms and email. Receipts get lost, managers approve late, and finance retypes every approved claim into Xero.

## Solution

An expense tracker: staff submit expenses with a receipt photo, managers approve claims, and finance sends approved claims to Xero every night.

## Actors

- Employee: submits expenses and claims.
- Manager: approves or rejects their team's claims.
- Finance: gives second approvals and runs the payroll export.

## Features

- F1 [Submit expenses](features/F1-submit-expenses.md)
- F2 [Approvals](features/F2-approvals.md)
- F3 [Payroll export](features/F3-payroll-export.md)
- F4 [Spending reports](features/F4-spending-reports.md)
- F5 [Mileage claims](features/F5-mileage-claims.md)

## Fog

- Corporate cards, once finance picks a card provider.
- Per-diem rates for overseas trips.
- Read-only access for the yearly external audit.

## Product-wide

Rules that apply to more than one feature, such as the audit log (P1) and company sign-in (P4), are on the [Product-wide](product-wide.md) page.

## Out of Scope

- A mobile app. Staff use the web app on their phones.
`;

const acmeF1 = `# Submit expenses

## Purpose

Employees record expenses with a receipt photo and submit them as a claim.

## User Stories

- F1.1 As an employee, I photograph a receipt and the amount and date are filled in for me.
- F1.2 As an employee, I pick a category for each expense: meals, travel or supplies.
- F1.3 As an employee, I save expenses as a draft and submit them later as one claim.
- F1.4 As an employee, I see which of my claims are pending, approved or rejected.

## Decisions

- A receipt is required for any expense above $25. [${POLICY} p.4]
- Meals are capped at $50 per day. [${POLICY} p.2]
- A claim can hold expenses from any dates.
- Amounts are entered as P3 describes; a submitted claim goes to F2 for approval.

## Out of Scope

- Corporate card transactions. Staff pay and claim back.
`;

const acmeF2 = `# Approvals

## Purpose

Managers approve or reject their team's claims; large claims also go to Finance.

## User Stories

- F2.1 As a manager, I see my team's pending claims in one list, oldest first.
- F2.2 As a manager, I approve or reject a claim with a reason.
- F2.4 As a manager going on leave, I name a deputy who approves in my place. *assumed*
- F2.5 As finance, I give a second approval on any claim over $1,000, after the manager. [${POLICY} p.7]

## Decisions

- A claim is approved by the employee's line manager.
- A rejected claim goes back to the employee to edit and resubmit. *assumed*
- Every approval and rejection is kept, as P1 requires.

## Out of Scope

- Approving mileage: F2.3 moved to Mileage claims.
`;

const acmeF3 = `# Payroll export

## Purpose

Finance sends approved claims to Xero every night and fixes the ones that fail.

## User Stories

- F3.1 As finance, I have approved claims sent to Xero every night. [${POLICY} p.9]
- F3.2 As finance, I see which claims failed to sync and why.
- F3.3 As finance, I resend a failed claim after fixing it.

## Decisions

- Xero accepts up to 100 invoices per API call. [Xero API docs]
- Each claim becomes one bill in Xero, with one line per expense.
- A claim over $1,000 is sent only after its second approval (F2.5).
`;

const acmeF4 = `# Spending reports

## Purpose

Finance sees where the money goes, by team and category.
`;

const acmeF5 = `# Mileage claims

## Purpose

Staff claim for driving to client sites.

## User Stories

- F5.1 (was F2.3) As a manager, I see the route and distance when I approve a mileage expense.
`;

const acmeProductWide = `# Product-wide

Rules that apply to more than one feature.

## Requirements

- P1 Every approval, rejection and edit is recorded in an audit log.
- P2 Expense records are kept for 7 years. [${POLICY} p.10]
- P3 Amounts are in the company currency, stored in cents.
- P4 Staff sign in with company SSO. [org default]

## Decisions

- One currency only (USD). No multi-currency.
`;

const featurePath = (file: string) => `requirements/features/${file}.md`;

/** The agent's write: `markdown` with `line` added after the line starting `after`. */
function withLineAfter(markdown: string, after: string, line: string): string {
  const start = markdown.indexOf(after);
  if (start < 0) throw new Error(`fixture: no line starting "${after}"`);
  const end = markdown.indexOf("\n", start);
  return `${markdown.slice(0, end + 1)}${line}\n${markdown.slice(end + 1)}`;
}

const auditorProposal: Proposal = {
  id: "auditor",
  title: "Add an Auditor who can read everything",
  summary: "4 changes across Actors, Approvals, Payroll export and Product-wide",
  by: { agent: "spec-agent", at: "2026-09-29T15:42:00Z" },
  files: [
    "requirements/prd.md",
    featurePath("F2-approvals"),
    featurePath("F3-payroll-export"),
    "requirements/product-wide.md",
  ],
  leavesFog: [{ text: "Read-only access for the yearly external audit.", becomes: "the Auditor" }],
  productWide: [{ id: "P5", appliesTo: ["F2", "F3"] }],
  writes: {
    "requirements/prd.md": withLineAfter(acmePrd, "- Finance:", "- Auditor: reads every claim and decision; changes nothing."),
    [featurePath("F2-approvals")]: withLineAfter(
      acmeF2,
      "- F2.5 ",
      "- F2.6 As an auditor, I see every approval decision with its reason. *assumed*",
    ),
    [featurePath("F3-payroll-export")]: withLineAfter(
      acmeF3,
      "- F3.3 ",
      "- F3.4 As an auditor, I export a year of approved claims. *assumed*",
    ),
    "requirements/product-wide.md": withLineAfter(
      acmeProductWide,
      "- P4 ",
      "- P5 An auditor can read every claim, decision and export, and change none of them.",
    ),
  },
};

export const acmeExpensesSpec: SpecModel = {
  features: [
    {
      id: "F1",
      name: "Submit expenses",
      path: featurePath("F1-submit-expenses"),
      purpose: "Employees record expenses with a receipt photo and submit them as a claim.",
      stage: "Interviewed",
      blocking: null,
    },
    {
      id: "F2",
      name: "Approvals",
      path: featurePath("F2-approvals"),
      purpose: "Managers approve or reject their team's claims; large claims also go to Finance.",
      stage: "Interviewed",
      blocking: null,
    },
    {
      id: "F3",
      name: "Payroll export",
      path: featurePath("F3-payroll-export"),
      purpose: "Finance sends approved claims to Xero every night and fixes the ones that fail.",
      stage: "Interviewed",
      blocking: {
        question: "Does finance post to one Xero organisation, or one per country?",
        why: "Every Payroll export story depends on which Xero organisation a claim goes to.",
        options: [
          "Finance posts every claim to one Xero organisation.",
          "Each country has its own Xero organisation; a claim goes to the employee's country.",
        ],
      },
    },
    {
      id: "F4",
      name: "Spending reports",
      path: featurePath("F4-spending-reports"),
      purpose: "Finance sees where the money goes, by team and category.",
      stage: "Not interviewed",
      blocking: null,
    },
    {
      id: "F5",
      name: "Mileage claims",
      path: featurePath("F5-mileage-claims"),
      purpose: "Staff claim for driving to client sites.",
      stage: "Not interviewed",
      blocking: null,
    },
  ],
  productWide: [
    { id: "P1", appliesTo: "all" },
    { id: "P2", appliesTo: "all" },
    { id: "P3", appliesTo: ["F1", "F3"] },
    { id: "P4", appliesTo: "all" },
  ],
  documents: [
    {
      id: "tne-policy",
      title: "Acme T&E Policy v3.pdf",
      pages: 12,
      rows: [
        { page: "p.2", says: "Meals are capped at $50 per day.", landedIn: "F1 Submit expenses, a decision" },
        { page: "p.4", says: "A receipt is required for any expense above $25.", landedIn: "F1 Submit expenses, a decision" },
        { page: "p.7", says: "Claims over $1,000 need a second approval from Finance.", landedIn: "F2.5" },
        { page: "p.8", says: "A mileage claim shows the route driven.", landedIn: "F2.3" },
        { page: "p.9", says: "Approved claims are synced to Xero every night.", landedIn: "F3.1" },
        { page: "p.10", says: "Expense records are kept for 7 years.", landedIn: "P2" },
        { page: "p.11–12", says: "Travel booking rules.", landedIn: null },
      ],
    },
  ],
  design: { designedFrom: {}, openComments: 0, specChanges: [] },
  proposal: auditorProposal,
  files: {
    "requirements/prd.md": acmePrd,
    [featurePath("F1-submit-expenses")]: acmeF1,
    [featurePath("F2-approvals")]: acmeF2,
    [featurePath("F3-payroll-export")]: acmeF3,
    [featurePath("F4-spending-reports")]: acmeF4,
    [featurePath("F5-mileage-claims")]: acmeF5,
    "requirements/product-wide.md": acmeProductWide,
  },
};

// A small product: two features, so its product page is the feature list alone.

const triagePrd = `# Triage agent

## Problem Statement

Support gets 300 tickets a day, and the urgent ones wait in the same queue as the rest.

## Solution

An agent that reads each incoming ticket, sorts it by urgency, and drafts a first reply for a person to send.

## Actors

- Support agent: reviews the sorted queue and sends replies.

## Features

- F1 [Classify tickets](features/F1-classify-tickets.md)
- F2 [Draft replies](features/F2-draft-replies.md)

## Out of Scope

- Sending replies without a person approving them.
`;

const triageF1 = `# Classify tickets

## Purpose

Every incoming ticket is sorted by urgency before anyone reads it.

## User Stories

- F1.1 As a support agent, I see new tickets sorted as urgent, normal or low.
- F1.2 As a support agent, I change a ticket's urgency when the agent got it wrong.

## Decisions

- A ticket that mentions an outage is always urgent.
`;

const triageF2 = `# Draft replies

## Purpose

The agent drafts a first reply for each ticket, for a person to send.

## User Stories

- F2.1 As a support agent, I open a ticket and find a drafted reply ready to edit.
- F2.2 As a support agent, I send the draft as it is, or after editing it.

## Decisions

- A draft is never sent without a person pressing Send, as F1.2's corrections are.
`;

const triageProductWide = `# Product-wide

Rules that apply to more than one feature.

## Requirements

- P1 Staff sign in with company SSO. [org default]
`;

export const triageAgentSpec: SpecModel = {
  features: [
    {
      id: "F1",
      name: "Classify tickets",
      path: featurePath("F1-classify-tickets"),
      purpose: "Every incoming ticket is sorted by urgency before anyone reads it.",
      stage: "Interviewed",
      blocking: null,
    },
    {
      id: "F2",
      name: "Draft replies",
      path: featurePath("F2-draft-replies"),
      purpose: "The agent drafts a first reply for each ticket, for a person to send.",
      stage: "Interviewed",
      blocking: null,
    },
  ],
  productWide: [{ id: "P1", appliesTo: "all" }],
  documents: [],
  design: { designedFrom: {}, openComments: 0, specChanges: [] },
  proposal: null,
  files: {
    "requirements/prd.md": triagePrd,
    [featurePath("F1-classify-tickets")]: triageF1,
    [featurePath("F2-draft-replies")]: triageF2,
    "requirements/product-wide.md": triageProductWide,
  },
};

/** Any other project, a new one included: the kickoff has not written features yet. */
export function freshSpec(productName: string): SpecModel {
  return {
    features: [],
    productWide: [],
    documents: [],
    design: { designedFrom: {}, openComments: 0, specChanges: [] },
    proposal: null,
    files: {
      "requirements/prd.md": `# ${productName}\n\n## Features\n\nThe agent proposes features once it has read your brief.\n`,
      "requirements/product-wide.md": "# Product-wide\n\nRules that apply to more than one feature.\n",
    },
  };
}
