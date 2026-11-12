-- Dashboard Plus · M3 data-health score: when each Maplemonk table was last
-- written (table metadata only; no rows are read).
SELECT table_id AS table_name, TIMESTAMP_MILLIS(last_modified_time) AS last_modified
FROM `{{dataset}}.__TABLES__`
WHERE table_id IN UNNEST(@tables)
