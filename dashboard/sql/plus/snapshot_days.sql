-- Dashboard Plus · M7. Which days a snapshot table holds, with row counts.
SELECT CAST(snapshot_date AS STRING) AS snapshot_date, COUNT(*) AS rows_n, SUM(IFNULL({{qty}}, 0)) AS units
FROM `{{plus}}.{{table}}`
GROUP BY 1
ORDER BY 1
