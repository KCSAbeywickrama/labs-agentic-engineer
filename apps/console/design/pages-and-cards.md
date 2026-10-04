# Pages, Cards and their routes

The console's screens are **Pages** with **Cards** over them (`CONTEXT.md`,
"Console"). Each is a route; the route tree is what draws one over the other.

```
routes/_dashboard/
  route.tsx                  the Dashboard, the org's base Page (pathless)
    index.tsx                  /                       no card
    settings.tsx               /settings?section=ai    Settings card
routes/projects/$projectName/
  route.tsx                  the project: build picker host, build notes, ?chat=open
  _overview/route.tsx        the overview Page (pathless)
    index.tsx                  /projects/$p            no card
    spec.tsx                   /projects/$p/spec       Spec card
    design.tsx                 /projects/$p/design     Design card
  builds/route.tsx           build history           /projects/$p/builds
    $version.tsx               /projects/$p/builds/v2  Build card
  validations/route.tsx      the Validation ledger   /projects/$p/validations
    $version.tsx               /projects/$p/validations/v2  Validation card
  deploy/route.tsx           the Deploy Page         /projects/$p/deploy
    $env/configure.tsx         /projects/$p/deploy/staging/configure  Configure card
```

- **A Page is a layout route.** It renders `PageWithCards` around its content:
  the page as the base layer (`BasePage`) and an `<Outlet />` for its Cards.
  The page stays mounted under an open card, covered by its scrim and inert.
- **A Card is a child route of its Page**. Closing it (X, Escape, the scrim)
  navigates to the Page it is over.
- **The overview and the Dashboard are pathless** (`_overview`,
  `_dashboard`), so their cards keep short addresses (`/projects/$p/spec`,
  `/settings`); each Page's own address needs its `index.tsx` leaf. The
  Dashboard's leaf is also where an org with no projects is sent on to New
  project, so that only happens at `/`, never under Settings.
- **Every card is drawn by `CardFrame`** (`features/shell/components/`): the
  scrim, the frame, the header and close (X, Escape, the scrim), told where
  closing goes. A project's cards go through `CardOverlay`, which reads that
  from the tables below; the Settings card closes to `/` itself.
- **`features/shell/scope.ts` holds the tables**: which route IDs are Pages
  (`PAGE_ROUTES`, and `ORG_PAGE_ROUTES` for the org's), which are Cards
  (`CARD_ROUTES` and `ORG_CARD_ROUTES`, both read by `cardOfRoute`), and the
  Page each Card is over (`pageOfCard`; `ORG_CARD_PAGE`). The rail's active
  item, the chat's breadcrumb, the Turn scope and `CardOverlay`'s close all
  read them, so a new Card is a route file plus its rows there; a new project
  Page also needs its path in `CardOverlay`'s `PAGE_PATH`.
- **A Panel is not a route**: a Dialog owned by its Page or Card (the build
  picker, Try it, Settings' Rotate token and Disconnect). It has no address
  and leaves the chat as it was.

A Build card is a version's, over build history (the ledger of versions);
closing it goes back there. The overview's track opens the newest version's
Build card from its Build leg, and the build picker opens the version it
started. A Validation card is a version's too, over the Validation ledger:
its attempts, the chosen one by feature, Fix and Revalidate. The Build card
links to it, and a failing build's next step is "See what failed", there.
Neither sets a Turn scope: no agent works on one build or one validation yet,
so the chat stays on the whole product.

The Configure card sets no Turn scope: no agent can change an environment yet,
so `turnScopeFor` and `chatTopic` read it as the whole product. The Settings
card sets none either: it is the org's, and the org's chat is inert. It is
opened from the rail (the Settings icon above the user menu), not from the
Dashboard, and keeps its section in the address (`?section=github|ai|usage`).
