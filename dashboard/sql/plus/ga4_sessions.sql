-- Dashboard Plus · M3. GA4 sessions and engaged sessions per day and
-- source / medium (GA4 property @property), read-only from Maplemonk.
SELECT
  PARSE_DATE('%Y%m%d', date) AS date,
  LOWER(IFNULL(sessionSourceMedium, '(not set)')) AS source_medium,
  SUM(sessions) AS sessions,
  SUM(engagedSessions) AS engaged
FROM `{{dataset}}.GA4_GA4_asaya_sessions_users_by_date`
WHERE CAST(property_id AS STRING) = @property
  AND PARSE_DATE('%Y%m%d', date) BETWEEN @start_date AND @end_date
GROUP BY 1, 2
