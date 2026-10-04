# Pages, Cards and their routes

A project's screens are **Pages** with **Cards** over them (`CONTEXT.md`,
"Console"). Each is a route; the route tree is what draws one over the other.

```
routes/projects/$projectName/
  route.tsx                  the project: build picker host, build notes, ?chat=open
  _overview/route.tsx        the overview Page (pathless)
    index.tsx                  /projects/$p            no card
    spec.tsx                   /projects/$p/spec       Spec card
    design.tsx                 /projects/$p/design     Design card
    builds/index.tsx           /projects/$p/builds     Builds card
    builds/$version.tsx        /projects/$p/builds/v2  Builds card
  deploy/route.tsx           the Deploy Page         /projects/$p/deploy
    $env/configure.tsx         /projects/$p/deploy/staging/configure  Configure card
```

- **A Page is a layout route.** It renders `PageWithCards` around its content:
  the page as the base layer (`BasePage`) and an `<Outlet />` for its Cards.
  The page stays mounted under an open card, covered by its scrim and inert.
- **A Card is a child route of its Page**, rendering `CardOverlay`. Closing it
  (X, Escape, the scrim) navigates to the Page it is over.
- **The overview is pathless** (`_overview`), so its cards keep their short
  addresses under the project; its own address needs the `index.tsx` leaf.
- **`features/shell/scope.ts` holds the tables**: which route IDs are Pages
  (`PAGE_ROUTES`), which are Cards (`CARD_ROUTES`, read by `cardOfRoute`), and
  the Page each Card is over (`pageOfCard`). The rail's active item, the chat's
  breadcrumb, the Turn scope and `CardOverlay`'s close all read them, so a new
  Card is a route file plus its rows there; a new Page also needs its path in
  `CardOverlay`'s `PAGE_PATH`.
- **A Panel is not a route**: a Dialog owned by its Page (the build picker,
  Try it). It has no address and leaves the chat as it was.

The Configure card sets no Turn scope: no agent can change an environment yet,
so `turnScopeFor` and `chatTopic` read it as the whole product.
