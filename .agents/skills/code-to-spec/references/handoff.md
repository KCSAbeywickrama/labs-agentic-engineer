# Getting the specs into an AEP project

The tree `code-to-spec` writes is the state an AEP project reaches after `/start` and every
`/interview`, plus the domain model and the upstream dependency definitions. It enters a project
as the `.aespecs` bundle the skill wrote (`references/bundle-format.md`): the create dialog takes
it beside the reference documents, the platform seeds the project's repository from it in one
commit, and the project's first design is `/recreate`. Nothing is interviewed, pushed by hand or
registered beforehand.

1. **Create the project** in the console with the product's name and a one-line idea, and attach
   `<out>/<product>.aespecs` as a document. Attach the product's README or any brief too if you
   want the first design to read them. Create.
2. **The platform seeds the project.** It opens the bundle under its bounds, holds every file to its
   own readers, commits the files with the bundle's provenance, and uploads the documents. A
   refused bundle is named with the file and the rule on the create page; fix the output and press
   Retry seed. The kickoff interview never runs on a seeded project.
3. **Review and edit** the requirements in the spec view, as on any project: rewrite a story or a
   decision, answer an Open Question (what only the team knows), settle an `*assumed*` line (the
   skill's inferences). They hold nothing up, and Recreate designs what the spec view holds, not
   the bundle. A feature with a `*blocking*` question stays undesigned until it is answered. The
   dependency definitions and the domain model have no editor before the first design: the domain
   model converges in the Recreate itself, and a definition changes by re-running the skill and
   seeding the project again (`seed-project` on the API, before any turn; the console offers Retry
   seed only after a failed one), which replaces the seeded tree whole, edits included.
4. **Press Recreate** on the design card. It walks the design lineup for every feature with the
   dependency definitions as givens: they come up referenced by the components, never rewritten; a
   rewritten or duplicated one is a platform defect to report. From the second design on, the
   project iterates with `/design` like any other.
5. **Configure the upstreams.** After the design, each definition waits for its values: the Deploy
   page's Configure card lists every key per environment. Type them there. The build does not wait
   for them; the deploy does. To share a definition with other projects, open it on the Resources
   page, choose Promote to organization, and paste the brief's consumption instructions from
   `registrations/<name>.md`; values typed for the project carry over.

With a checkout of the platform repository, the first design can be tried locally first: copy the
output into the playground's projects directory and run `pnpm play <absolute path> chat "/recreate"`.
