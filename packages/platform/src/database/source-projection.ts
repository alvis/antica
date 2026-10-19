import { Prisma } from './generated/client.js';

/**
 * selects the committed run for a page from the active run or its immutable base
 * @returns a run identifier, or null when the page has never been parsed
 */
export function projectedParseRunId(): Prisma.Sql {
  return Prisma.sql`case
    when exists (
      select 1 from source_page_parses current_parse
      where current_parse.page_id = source_pages.id
        and current_parse.parse_run_id = source_versions.active_parse_run_id
    ) then source_versions.active_parse_run_id
    else (
      select (base_page.value ->> 'parseRunId')::uuid
      from job_steps base_step,
        jsonb_array_elements(base_step.result -> 'pages') base_page
      where base_step.job_id = source_versions.active_parse_run_id
        and base_step.stage_key = 'parse:base'
        and base_page.value ->> 'pageId' = source_pages.id::text
    )
  end`;
}
