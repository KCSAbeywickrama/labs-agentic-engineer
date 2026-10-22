# The `.aespecs` bundle

The archive the platform seeds a project from. `scripts/bundle.mjs` writes
it; the platform's reader is the authority on what it accepts, and the writer
refuses the same things so a stray file is caught here, not at upload.

## Shape

A zip (store-only from the writer; the reader accepts deflate too) whose root
holds `manifest.json` and the `specs/` tree:

```
manifest.json
specs/requirements/**.md                            the requirements, their features and coverage files
specs/design/domain-model.md
specs/design/dependencies/<name>/dependency.json
specs/design/dependencies/<name>/assumptions.md
specs/design/dependencies/<name>/schema.graphql     or openapi.yaml, openapi.yml, openapi.json, schema.graphqls, sdk.json
```

Nothing else is admitted: not `.inventory/`, not `registrations/`, not a
design file the platform derives (`design.cell`, a `design.json`,
`security.json`, `flows/`), not the descriptor or the reference documents.
Every file is UTF-8 text with no NUL byte. A dependency directory is
kebab-case and holds its files directly, never nested.

## Manifest

```json
{
  "format": "aespecs/1",
  "producer": { "name": "code-to-spec", "version": "1.0" },
  "product": "Allocations",
  "source": { "repository": "git@github.com:acme/allocations.git", "commit": "d14b825" },
  "createdAt": "2026-10-21T08:00:00Z"
}
```

`source.repository` is the product root's git remote, or `local checkout`
when there is none; `source.commit` is the commit the code was read at, 7 to
40 hex. The platform records the manifest in the project descriptor as the
bundle's provenance, so every `file:line` reference in the coverage files can
be resolved later.

## Bounds

The platform refuses a bundle over 5 MiB, over 256 entries, over 8 MiB
unpacked, any file over 5 MiB, and any file carrying what looks like a
credential: a private-key block, a `password`, `secret`, `token` or `api key`
assigned a value, a URL with credentials, a long high-entropy token. This
skill writes key names only, never values, so a refusal there is a leak to
find, not a rule to relax.

## After the upload

The platform validates the requirements and every definition with its own
readers, commits the files and the provenance in one commit, and never runs
the `/start` kickoff on the project. The user presses Recreate on the design
card; `references/handoff.md` has the order.
