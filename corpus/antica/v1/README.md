# Antica v1 corpus draft

This versioned research draft contains 56 entries, 315 cited claims, 65 topics,
67 immutable source snapshots, and 20 provisional owner questions across ceramics,
bronzes, jades, and furniture. All editorial, claim, translation, and authority
mapping reviews remain pending. A cited claim has captured evidence; validation
cannot establish entailment, translation accuracy, provenance, or authenticity.

## Editing and validation

Edit the taxonomy, source, entry, or question JSON using the strict corpus contract
in `packages/contracts/src/knowledge-corpus.ts`. Preserve stable content IDs,
original source text and Unicode, array order, attribution, and all discovered
image URLs in source snapshots. An entry may omit a reference to a captured URL
that does not depict the object. Store metadata and URLs only; never add image bytes or base64.
Source payloads preserve the captured Cleveland, Met, AIC and Wikidata responses.
AIC snapshots include metadata and IIIF responses. Original markup remains in
captured payloads and quotations; translations must be plain text.

Serialize JSON with sorted object keys and one final newline. Recompute payload
and locator value hashes over canonical JSON without a newline, and variant
hashes over the original UTF-8 claim text. The release lists every corpus file
except release manifests, with hashes over exact file bytes. Its manifestHash
hashes canonical release JSON with that field omitted. Regenerate these hashes
when editing, then run from the repository root:

```sh
pnpm corpus:validate --release 1.0.1
pnpm corpus:validate --dir corpus/antica/v1 --min-providers 2
```

The validator runs offline, reports file and JSON paths, and exits nonzero on any
failure. Each category needs five explanations, five object examples and two
supporting providers. `needs_source` claims may be retained but provide no
factual grounding. Rights are observed metadata and never gate eligibility.

Release 1.0.1 applies the source cross-check. Quoted museum titles use literal
translations; descriptive preferred display titles carry `editorial: true`, and
literal titles remain searchable aliases. `originalText`, original variants,
source payloads and museum quotations remain unchanged.

`sources/antica/institution-coverage.json` is Antica's own generated citation
inventory, labelled `Antica 語料庫清單` in its title, provider, contributors and
rights attribution. It is not museum evidence or an additional independent
institution. Its entry-specific locators support only corpus-coverage limits.
Regenerate it after changing source bindings or subject-claim citations:

```sh
pnpm --filter @antica/corpus inventory
```

The corpus check regenerates the expected snapshot in memory and fails on drift,
misattribution, wrong-entry coverage citations or use as subject evidence. Rehash
the release's exact-byte members and canonical manifest after regeneration.

## Review and operation

K7: the collector reviews a sample for the first corpus release; later releases
are checked automatically and only flagged entries return to the collector.
Claims, applicability, translations and authority mappings remain pending review.
Quarterly editorial releases and monthly upstream checks are separate
operations. This release remains a draft pending K7: publishedAt and reviewer are
absent, and no review state is upgraded by copying or validating the corpus.
Collector save must remain explicit and separate from import or editorial review.

`queries/owner.json` has `provisional: true`: research-authored questions and
0–3 relevance judgments are not owner gold or measured retrieval results.
Research captures and defect proofs remain in the external corpus-draft evidence
folder; they are intentionally excluded from this repository corpus.

Installation creates owner-private unsaved drafts without silently saving or
overwriting collector content. Use `pnpm corpus:install --owner-id <id> --release
1.0.1 --request-key <uuid>` with `DATABASE_URL` pointing to the target database.
This editorial release does not assert collector approval or authentication.
