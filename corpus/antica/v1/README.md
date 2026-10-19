# Antica v1 corpus draft

This versioned research draft contains 56 entries, 315 cited claims, 65 topics,
66 immutable source snapshots, and 20 provisional owner questions across ceramics,
bronzes, jades, and furniture. All editorial, claim, translation, and authority
mapping reviews remain pending. A cited claim has captured evidence; validation
cannot establish entailment, translation accuracy, provenance, or authenticity.

## Editing and validation

Edit the taxonomy, source, entry, or question JSON using the strict corpus contract
in `packages/contracts/src/knowledge-corpus.ts`. Preserve stable content IDs,
original source text and Unicode, array order, attribution, and all discovered
image URLs. Store metadata and URLs only; never add image bytes or base64.
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
pnpm corpus:validate --release 1.0.0
pnpm corpus:validate --dir corpus/antica/v1 --min-providers 2
```

The validator runs offline, reports file and JSON paths, and exits nonzero on any
failure. Each category needs five explanations, five object examples and two
supporting providers. `needs_source` claims may be retained but provide no
factual grounding. Rights are observed metadata and never gate eligibility.

## Review and operation

K7: the collector reviews claims, applicability, translations and authority
mappings. Quarterly editorial releases and monthly upstream checks are separate
operations. This release remains a draft pending K7: publishedAt and reviewer are
absent, and no review state is upgraded by copying or validating the corpus.
Collector save must remain explicit and separate from import or editorial review.

`queries/owner.json` has `provisional: true`: research-authored questions and
0–3 relevance judgments are not owner gold or measured retrieval results.
Research captures and defect proofs remain in the external corpus-draft evidence
folder; they are intentionally excluded from this repository corpus.

Installation (KDB09) is not yet available. The future installer must create
owner-private unsaved drafts and must not silently save or overwrite collector
content. No installation or release publication is claimed here.
