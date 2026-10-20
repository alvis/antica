# Examination guides in corpus 1.1.0

The `examination_guide` kind adds reference checklists for 汝窯、斗彩、青銅、古玉及黃花梨. Product authority remains the [Code Specification](https://app.notion.com/p/3f7b2572f78881a39becf965abbf9f2a). Guides describe source-backed observations and missing evidence; they carry no machine consistency judgments about a collector's object.

## Compatibility and commands

Ship the updated contracts and corpus tooling together with release 1.1.0. Older tools reject the new file kind. Existing 1.0.1 files and their manifest remain unchanged. The updated tooling supports explicit historical release selection; installation selects that release's members and creates knowledge drafts only from entries. Guide documents never become owner knowledge drafts or satisfy explanatory-entry minima.

From the repository root:

```sh
pnpm corpus:validate --release 1.1.0
pnpm corpus:validate --release 1.0.1
pnpm corpus:install --owner-id <id> --release 1.1.0 --request-key <uuid>
```

Installation requires `DATABASE_URL`. Collector saving remains a separate explicit action. Validation checks structure, hashes and reference binding; independent sentence and translation review supplies the semantic cross-check.

## Guide content and evidence

Files under `guides` retain stable `checkKey`s, a `guideVersion`, bilingual labels, type-specific `appliesToTopicIds` and `framing: "observation_not_verdict"`. Checks follow form → material/body → surface → decoration/technique → base and marks → wear/age → repairs/alterations → documentation. Statements reuse the corpus claim and translation contracts, with `field` replacing `section`.

English `originalText` and original variants preserve their source draft bytes. A statement without adequate evidence remains `needs_source`; its field is recorded in `gap`. Such text is archival and must render as 待補來源, never as factual instruction. Quoted titles use literal translations; preferred display labels may describe the subject.

Sources under `sources/examination` preserve captured quotations and context, retrieval metadata, original capture hashes, observed rights, `licenceBasis` and an `authorizationNote`. The collector's authorization dated 2026-10-20 applies to the surveyed sources, including V&A and NC/ND material. It does not change the observed licence or imply access to blocked content. Blocked, login-only, paywalled and unfetched candidates remain explicitly identified as unavailable evidence. No block was circumvented; Smithsonian access is limited to `DEMO_KEY`.

Book citations retain printed page labels in page locators. Unknown scan indices remain absent. Because these sources have no uploaded page assets, installation represents their page references as web evidence with a printed-page section, preserving the page metadata without inventing an uploaded asset identity.

Reference photos have explicit `showable` and `role` (`typical` or `warning`) metadata. Permission to show an object photograph does not establish that it depicts the detail described by a check. Unverified views and missing detail photographs remain limitations.

## Record context

Verdict-worded quotations remain attributed historical or museum opinion. Their citations and dependent statements carry `attributedOpinion` and `verdictLanguage` flags. Use `filterGuideStatementsForRecord` from `@antica/contracts` before presenting guide statements beside a collector's object: it excludes flagged statements, statements using flagged citations, unsourced statements and unresolved citation references. Preserve source attribution when showing the opinion in the standalone reference guide.

This release supplies the corpus contract and tooling. Screen integration and collector review remain separate from corpus installation; validation or installation does not assert collector approval, provenance or authenticity.
