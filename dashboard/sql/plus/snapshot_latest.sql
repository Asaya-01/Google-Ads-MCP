-- Dashboard Plus · M7. The latest snapshot's rows.
SELECT *
FROM `{{plus}}.{{table}}`
WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM `{{plus}}.{{table}}`)
