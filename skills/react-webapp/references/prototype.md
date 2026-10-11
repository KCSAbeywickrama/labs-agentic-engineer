# Building from the prototype

The design gives each `web-application` a prototype. The business reviewer
used it and commented on it before the build. It is the **screen contract**:
build what it shows, screen for screen. The validation run compares the
deployed app with the prototype, so a missing screen, a dropped control or a
changed label is a defect at that stage.

Two files in `specs/design/components/<name>/`, under the project root:

- **`prototype.json`, the manifest.** `name` is the application's name. The
  `roles` ids are the role names of `security.json`. Each of the `screens` has
  an `id`, a `name` and the `roleIds` that reach it. Each of the `flows` is one
  role's walk (`roleId`) through `screenIds`, entry screen first.
  `entryScreen` is where the prototype opens. `states` are the display states
  the reviewer looked at (`state.default`, `state.empty`, …).
- **`prototype.tsx`, the screens.** `defineApp({ screens, data })` at the end
  maps each screen id to a React component. That component is what the screen
  shows. `data` holds the sample records.

The task's `## Scope` names your screens (`Screens:`) and flows (`Flows:`).
The prototype holds their content, and it wins over the issue text when the
two differ.

## A reference, not code

`prototype.tsx` is written against `@wso2/prototype-kit`, a fixed set of review
components on a mock runtime. The app is a different program: Vite, the
organization's design system, generated API clients and real requests.

- Do not import `@wso2/prototype-kit`, and do not copy `prototype.tsx` or a
  part of it into the app.
- Read each screen component for **what** it shows: the elements, their order,
  their labels, where each one navigates, and what each role and each display
  state changes.
- Build each element with the design system. The design-system skill maps each
  kit component to its own component. With no design-system skill, use the
  closest plain component of the stack.
- The prototype's `useCollection`, `useValue`, `useRole` and
  `useDisplayState` hooks are review machinery. The app gets the same facts
  from the API, the session and the real request state.

## Screen for screen

- **One manifest screen is one route and one page.** Name the route and the
  page after the screen id, without the `screen.` prefix: `screen.team-queue`
  → `/team-queue`, `TeamQueuePage`. A screen that reads `useParams()` takes
  each parameter as a path segment: `/claim-detail/:claim`. Then the mapping
  is clear in the PR.
- **Build every screen, and no screen that the manifest does not have.** If
  you cannot build a screen as the prototype shows it (its data has no
  operation, its action has no endpoint), build the remainder, show the gap
  in the UI, and put it in your report. Do not fold it into a different page.
- **Each role screen stays its own route.** When the manifest gives two roles
  two screens (`Team approvals` for a manager, `My claims` for an employee),
  each is a route with only the controls and columns its screen shows. Do not
  merge them into one page that changes for the viewer. You can share a
  component where the views are really the same.
- **A screen that more roles reach can differ by role.** `prototype.tsx`
  branches on `useRole()` to show a control to one role only. In the app, the
  same difference comes from the operation gate (`<Can op={…}>`), never from a
  role name.
- **The app shell's screens.** The `<AppShell>` gives every role an account
  screen, a settings screen and Sign out. Account and Settings are routes,
  reached from the user menu. Sign out is an action: with an auth dependency
  it calls `signOut()`, and the identity provider shows what comes next. The
  prototype's signed-out screen therefore is not a route of the app.
- **`/forbidden` and `NoAccess` are platform views.** No prototype draws them.
  Every app with an auth dependency has both, from `thunder-authentication`'s
  `authz` assets. If they are missing, that is a defect.

**Gate each screen on the operation it loads**: the call whose answer the
screen shows when it opens. Use `thunder-authentication`'s `authz` assets,
copied verbatim and never written again. Name the operation once in
`src/authz/screens.ts` (`loads: "GET /me/claims"`). Then put
`<RequireOperation op={…} />` around the route and `<Can op={…}>` around the
navigation entry that reaches it. A form with no load call names the operation
its submit makes. `loads: null` is only for a screen that needs no operation,
such as the account screen. All of this is **presentation only**: the gateway
enforces the operation's scope. A component with no auth dependency has no
gate: every screen and every control is open to every user.

## Element for element

Read each screen component from top to bottom. Make each kit element a real
element, in that order, with that literal content:

| Kit | Build |
|---|---|
| `<AppShell>` | the design system's app shell. The brand is the manifest's `name`. Its `nav` entries are the side navigation, ONE rail for all roles, each entry in `<Can op={…}>`. Its user menu has Account, Settings, the `menu` entries and Sign out (outside the `Can`) |
| `<Heading text actions>` | the page title, with its `actions` as the page's buttons |
| `<Section title count subtitle actions>` | a titled part of the page, with its count, its subtitle and its own action buttons |
| `<Stat label value hint icon tone>` in a `<StatGroup>` | a row of stat tiles of one width: that label, the value bound to live data, that hint |
| `<Table columns rows empty>` | a data table with exactly those columns, bound to the real list. A row with `to` opens that screen. Row `actions` are buttons in the row. A `kind: "status"` column is a status chip; a `kind: "number"` column is aligned for numbers. `empty` is the table's empty state |
| `<Filters>` | the filter controls of that list, wired to narrow it |
| `<Form>` with `<Field>`s | a form whose controls have the Field labels, `type`, `required` and `pattern`, and whose submit calls the operation |
| `<Field error>`, `<ValidationSummary>` | the field's error text and the form's error summary, from the validation and the API's 4xx answer |
| `<Button emphasis>` | `primary` is the page's primary button, and only those are primary; `danger` is a destructive button; any other is a secondary button |
| `<Link>`, `<Breadcrumbs>`, `<Tabs>`, `<Stepper>` | the same primitive with the same labels and targets |
| `<Detail fields>` | the record's labels and values |
| `<Badge>`, `<Alert>`, `<EmptyState>`, `<Timeline>`, `<Text>` | the matching primitive: a status is a chip, not a paragraph; an `Alert`'s `tone` is the severity |
| `<Dialog>`, `<Drawer>` | a modal or a side panel, opened by the same control |
| `<Stack>`, `<Grid>`, `<Split>` | the same layout: in a column, in a grid, side by side |

**A table column that the list does not return.** Fill it from **one** more
request to another list operation that every role that loads the screen can
call: a name joined on id from the entity list, or a count from the child
list, filtered one time and grouped. Never send one request per row. Never
drop the column while a list operation can supply it. If no list operation
can supply it, that is a contract gap: report it.

**Labels are copy.** "Awaiting you" and "Submit claim" appear on the page as
written. Change a label only when it is incorrect for the data that the API
returns, and say so in the PR.

**Build the display states.** The manifest's `states` and the screen's
branches on `useDisplayState()` show what each state looks like:
`state.empty` the empty list, `state.validation-error` the field errors,
`state.failed` the error alert, `state.delayed` the alert for a slow result.
Show each one from its real cause (an empty list, a refused submit, a failed
request, a pending job), never from a switch. Every list and every data region
also needs a loading state. A region whose operation the viewing role cannot
call shows its own forbidden state: it does not disappear, and it is not the
screen's `Forbidden`.

**The sample data is the mock's seed.** The reviewer compared the screens
against the records in `defineApp({ data })`, so mock mode shows the same
records. Map each record onto the provider's schema in the mock handlers
(`references/mock-mode.md`), and derive each stat value from those records.
The deployed app starts with no data.

## Arrow for arrow

Every `to` (on a `Button`, a `Link`, a table row, a row action, a breadcrumb,
a navigation entry) and every `useNav().go(…)` after an action is **working
navigation** to that screen's route. The navigation entry of the screen it is
on is the active entry, and it is still a link.

After a create, go to the screen that `useNav().go(…)` names. If that list has
a filter, open it with a filter value that includes the new row.

Each flow in the manifest is a walk that its role must complete by clicking:
the first screen first, and each screen reachable from the screen before it.
A screen that you cannot reach from its flow is a broken page, even if it
renders.

## The evidence

Two lists, one pair. The **Task** has a `Screens:` line and a `Flows:`
checklist with no box ticked. That is what you must build, and you work from
it. The **PR body** has the same two lists with the earned boxes ticked. Never
tick the Task's copy: re-planning writes that body again.

The ticks are **evidence, not a claim**, and they come from the walk. After a
clean build, `mock-verification` opens the app in a browser, reaches every
screen, uses every control and follows every `to`. It reports one line for
each flow and each screen. The lead ticks the PR's lists from that report when
it opens the PR. You write no checklist. A screen that you could not build as
the prototype shows it is a gap that you name in your report to the lead, and
the walk records it.

```text
Prototype fidelity (specs/design/components/<name>/prototype.json)

Screens
- [x] My claims (screen.my-claims) → /my-claims
- [x] Team approvals (screen.team-queue) → /team-queue
- [ ] New expense (screen.new-claim) → /new-claim — "Receipt" field not built: no upload operation

Flows
- [x] Flow 1 · Submit an expense claim (Employee) — stories F1.1, F1.2
- [ ] Flow 2 · Approve a team member's claim (Manager) — stories F2.1, F2.2 — breaks at
      Team approvals → Review team claim: the row does not open
```

**Screens** come from the Task's `Screens:` line, one line each, with the
route you built. A screen is ticked when the walk reached it, used every
control and followed every `to`.

**Flows** come from the Task's `Flows:` checklist, with the same number, name,
persona and stories, on one line each. A flow is ticked when the walk went
through its screens from end to end by clicking. Otherwise the line names the
step where it broke. A flow that the Task lists stays in the PR even when you
could not build it: a dropped line hides a missing journey and its stories.

Layout, spacing and the exact look are outside the walk. They stay the
reviewer's comparison of the prototype with the running page.
