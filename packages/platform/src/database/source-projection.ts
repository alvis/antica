import { sql } from 'drizzle-orm';

import {
  jobSteps,
  sourcePageParses,
  sourcePages,
  sourceVersions,
} from './schema/index.js';

import type { SQL } from 'drizzle-orm';

/**
 * selects the committed run for a page from the active run or its immutable base
 * @returns a run identifier, or null when the page has never been parsed
 */
export function projectedParseRunId(): SQL<string | null> {
  return sql<string | null>`case
    when exists (
      select 1 from ${sourcePageParses} current_parse
      where current_parse.page_id = ${sourcePages.id}
        and current_parse.parse_run_id = ${sourceVersions.activeParseRunId}
    ) then ${sourceVersions.activeParseRunId}
    else (
      select (base_page.value ->> 'parseRunId')::uuid
      from ${jobSteps} base_step,
        jsonb_array_elements(base_step.result -> 'pages') base_page
      where base_step.job_id = ${sourceVersions.activeParseRunId}
        and base_step.stage_key = 'parse:base'
        and base_page.value ->> 'pageId' = ${sourcePages.id}::text
    )
  end`;
}
