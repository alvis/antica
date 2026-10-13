UPDATE "records" AS record
SET "latest_run_id" = latest.id
FROM (
  SELECT DISTINCT ON ("owner_id", "record_id")
    "id", "owner_id", "record_id"
  FROM "analysis_runs"
  WHERE "status" IN ('completed', 'partial')
    AND "raw_output" IS NOT NULL
  ORDER BY "owner_id", "record_id", "created_at" DESC, "id" DESC
) AS latest
WHERE record."id" = latest.record_id
  AND record."owner_id" = latest.owner_id
  AND record."latest_run_id" IS NULL;
