import { Prisma } from '../../generated/client.js';

/**
 * resolves legacy citations and image locators in bulk with source ownership checks
 * @param ownerId authenticated collector
 * @returns evidence CTEs for the selected revision
 */
export function legacyEvidenceSql(ownerId: string): Prisma.Sql {
  return Prisma.sql`locators AS MATERIALIZED (
 SELECT l.id,CASE WHEN l.kind='web' THEN jsonb_build_object('kind','web','sourceId',l.source_id,'sourceVersionId',l.source_version_id,'url',l.url,
 'retrievedAt',to_char(l.retrieved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'snapshotAssetId',l.snapshot_asset_id,'blockId',l.block_id,'excerptAsRetrieved',l.excerpt_as_retrieved)
 ELSE jsonb_build_object('kind','page','sourceId',l.source_id,'sourceVersionId',l.source_version_id,'pageId',l.page_id,'pageIndex',l.page_index,'printedPageLabel',l.printed_page_label,
 'canonicalViewId',l.canonical_view_id,'regionId',l.region_id,'region',l.geometry,'textRange',CASE WHEN l.block_id IS NOT NULL AND l.range_start IS NOT NULL AND l.range_end IS NOT NULL THEN jsonb_build_object('blockId',l.block_id,'start',l.range_start,'end',l.range_end) ELSE NULL END) END value
 FROM source_locators l JOIN sources src ON src.id=l.source_id AND src.owner_id=${ownerId} JOIN source_versions v ON v.id=l.source_version_id AND v.owner_id=${ownerId}
 WHERE EXISTS(SELECT 1 FROM selected WHERE content_schema_version<>2)),
 citation_items AS (SELECT c.id,jsonb_build_object('id',c.id,'relation',c.relation,'availability',c.availability,'verification',c.verification,'locator',l.value) value
 FROM selected s JOIN knowledge_revision_citations k ON k.entry_id=s.id AND k.revision=s.revision JOIN citations c ON c.id=k.citation_id JOIN locators l ON l.id=c.locator_id),
 image_items AS (SELECT i.id,jsonb_build_object('id',i.id,'sourceVersionId',i.source_version_id,'locator',l.value,'figureRegionId',i.figure_region_id,'storedDerivativeId',i.stored_derivative_id,'externalImageUrl',i.external_image_url,
 'originalCaption',CASE WHEN i.caption_text IS NOT NULL AND i.caption_text<>'' AND caption.value IS NOT NULL THEN jsonb_build_object('textAsPrinted',i.caption_text,'locator',caption.value) ELSE NULL END,
 'generatedDescriptionZhHant',i.generated_description_zh_hant,'descriptionJobId',i.description_job_id,'captionAssociation',i.caption_association) value
 FROM selected s JOIN reference_images i ON i.id::text IN(SELECT jsonb_array_elements_text(s.content->'exampleReferenceImageIds')) JOIN source_versions v ON v.id=i.source_version_id AND v.owner_id=${ownerId} JOIN locators l ON l.id=i.locator_id LEFT JOIN locators caption ON caption.id=i.caption_locator_id
 WHERE s.content_schema_version<>2)`;
}

/**
 * reconstructs legacy methods, images and citations without per-item reads
 * @param ownerId authenticated collector
 * @returns complete compatibility detail JSON
 */
export function legacyDetailSql(ownerId: string): Prisma.Sql {
  return Prisma.sql`jsonb_build_object('entry',jsonb_build_object('id',s.id,'displayCode',s.display_code,'revision',s.revision,'status',s.status,'savedBy',s.saved_by,
 'createdAt',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char((CASE WHEN s.revision=s.current_revision THEN s.updated_at ELSE s.revision_created_at END) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'methodIds',coalesce((SELECT jsonb_agg(method_id ORDER BY method_id) FROM knowledge_revision_methods WHERE entry_id=s.id AND revision=s.revision),'[]'::jsonb),
 'content',s.content||jsonb_build_object('aliases',coalesce((SELECT jsonb_agg(alias ORDER BY alias) FROM knowledge_revision_aliases WHERE entry_id=s.id AND revision=s.revision),'[]'::jsonb),
 'kinds',coalesce((SELECT jsonb_agg(kind ORDER BY kind) FROM knowledge_revision_kinds WHERE entry_id=s.id AND revision=s.revision),'[]'::jsonb),'citations',coalesce((SELECT jsonb_agg(value ORDER BY id) FROM citation_items),'[]'::jsonb))),
 'methods',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'owningEntryId',m.owning_entry_id,'currentVersionId',m.current_version_id) ORDER BY m.id) FROM knowledge_revision_methods k JOIN inspection_methods m ON m.id=k.method_id JOIN knowledge_entries e ON e.id=m.owning_entry_id AND e.owner_id=${ownerId} WHERE k.entry_id=s.id AND k.revision=s.revision),'[]'::jsonb),
 'methodVersions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'methodId',v.method_id,'revision',v.revision,'definition',v.definition,'createdAt',to_char(v.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY v.id) FROM knowledge_revision_methods k JOIN method_versions v ON v.id=k.method_version_id JOIN inspection_methods m ON m.id=v.method_id JOIN knowledge_entries e ON e.id=m.owning_entry_id AND e.owner_id=${ownerId} WHERE k.entry_id=s.id AND k.revision=s.revision),'[]'::jsonb),
 'referenceImages',coalesce((SELECT jsonb_agg(value ORDER BY id) FROM image_items),'[]'::jsonb),'citations',coalesce((SELECT jsonb_agg(value ORDER BY id) FROM citation_items),'[]'::jsonb))`;
}
