// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

// Package run is the MILESTONE RUN SUPERVISOR: the Temporal workflows that work
// one milestone until it settles.
//
// There are THREE run species, and each is its own top-level workflow — a
// species is a workflow, not a branch (ADR-0020):
//
//	dev-<org>-<project>-<milestone>          DevRunWorkflow
//	task-<org>-<project>-<milestone>          TaskRunWorkflow
//	validation-<org>-<project>-<milestone>    ValidationRunWorkflow
//
// The id is keyed by the MILESTONE and prefixed by the KIND. A milestone sees
// sequential runs of one kind across its life, so the id is reused after a
// terminal run; the prefix is what keeps the three apart, because ids are reused
// under ALLOW_DUPLICATE and a stale signal aimed at a settled dev run would
// otherwise land on the validation run that claimed the id afterwards. The run
// ROW is the routing table: the event plane resolves a row before it signals
// anything, and the row's kind gives both the prefix and the workflow type.
//
// # dev and task: the cycle loop
//
//	WAIT ──► dispatch the coding agent ──► PR opened ──► auto-merge ──► builds + deploy
//	 ▲        (prompt = milestone reference only)                            │
//	 │  all green, open issues remain ─────────────► next cycle (re-WAIT)    │
//	 │  red after the one automatic re-trigger ─► FIX issue ─► next cycle    │
//	 │  merge conflict ─────────────────────────► CONFLICT issue ─► next     │
//	 └─ working set empty (armed, kind ∈ development/bug/conflict) ──► the run's
//	    own BOOKEND ──► settle
//	    budgets exhausted / no progress / cancel ─► failed | blocked | cancelled
//
// They are the SAME loop with different bookends — one `bookends` value, never
// two cycle loops that drift apart:
//
//	dev   before:  provisionGates → planTasks (it owns the version it is filling)
//	      onEmpty: mint the version's validation task → settle succeeded
//	task  before:  nothing (the milestone was filled by the build that shipped it)
//	      onEmpty: settle succeeded
//
// A dev run therefore **settles at deployed-green having minted the validation
// task, and never validates**. Its verdict column stays EMPTY, which is the
// honest reading of "delivered, not yet judged" — the exception is a project with
// no acceptance oracle, where no task is filed, nothing will ever judge the
// version, and `skipped` says so.
//
// # validation: its own shape, and no working set
//
//	adopt-or-mint the validation task (it is the VERSION's persistent handle)
//	  └─► one agent stage, anchored at that issue, AEP_TASK_KIND=validation
//	        └─► read the verdict at the cycle's OWN merge SHA
//	              ├─ not fatal ──────────────► close the task · succeeded
//	              ├─ unreported, budget left ► re-dispatch inside this workflow
//	              └─ failed ────────────────► one repair issue per failed criterion
//	                                          · close the task · failed
//
// It does not share the cycle loop at all: it polls no working set, and it BUILDS
// AND DEPLOYS NOTHING — its pull request touches only `tests/`, so the merge's
// path diff yields no components and both later stages were already silent
// no-ops for it. Skipping them outright is the honest form of that.
//
// It is started by the reconcile sweep, because an open `validation`-kind issue
// exists, or by a human asking a shipped version's criteria again. The task is
// closed on EVERY ending, verdict or not: the sweep's trigger IS that open issue,
// so a run that gave up and left it open would be restarted within a tick,
// forever, with nothing outside the workflow able to repair a dead dispatch.
//
// Two facts span validation runs — the version's attempt allowance and the
// previous report's digest — and both are DERIVED from the milestone's own
// validation runs rather than carried, because each attempt is its own execution
// and the previous one's state is gone.
//
// # Division of labour
//
// The supervisor DECIDES; it detects nothing. Every fact about the world
// arrives from `delivery/eventcore` as a run signal, and the supervisor
// re-derives that fact from GROUND TRUTH before acting on it — a signal is a
// wake-up, never evidence. That is what makes a lost delivery cost latency
// instead of correctness, and it is why the wait state can be unbounded: the
// cycle-boundary poll and the reconcile sweep both re-read the milestone.
//
// The two packages never import each other. They share the milestone
// vocabulary (labels, run signals, the run and cycle rows, the build-fan-out
// naming) through the delivery ROOT, and they reach each other only through
// ports: `eventcore.RunSignaler`/`RunStarter` inbound, and nothing outbound.
//
// # Internal shape
//
// Separated by FILE, one package, over one shared `loop` struct — it owns the
// signal channels, the budgets and the cycle state, and every workflow wants all
// three. Sub-packages would be LESS protected: `internal/arch` gives siblings a
// blanket import ban with no layer concept, and second-level packages are
// unchecked in both directions.
//
//	activities.go            the single Activities struct — ONE RegisterActivity
//	stage_agent.go           append cycle · dispatch · await landing · re-dispatch
//	stage_build.go           await the merge's fan-out
//	stage_deploy.go          plan waves · promote · await Ready · converge
//	stage_boundary.go        the shared loop · poll · dispatchable? · budgets · park
//	workflow_dev.go          gates + plan + boundary loop + mint the validation task
//	workflow_task.go         boundary loop with empty bookends
//	workflow_validation.go   one agent stage + verdict + repair issues + close
//	register.go              RegisterWorkflow per workflow, one RegisterActivity
//	worker.go                one task queue, one worker
//
// ONE `Activities` struct is not a style choice. Temporal registers an activity
// by its reflected METHOD NAME, so two activity structs sharing any method name
// panic the worker at Start — and three structs carved out of one loop would
// share a great many. Three workflows taking method expressions off one struct is
// the only shape that cannot break that way.
//
// # What this package does not hold
//
// No gorm (persistence is reached through ports onto the root repositories),
// no GitHub client, no Kubernetes, and no issue-body parsing. The agent
// dispatch is the root `delivery.MilestoneDispatcher` port, satisfied by the
// coding agent — the supervisor hands over a milestone reference and learns
// what happened from webhooks.
package run
