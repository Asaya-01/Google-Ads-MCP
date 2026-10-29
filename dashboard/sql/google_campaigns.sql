-- Every Google campaign ID with its latest name, rebuilt on every run so the
-- Awareness set is never hard-coded. Paused campaigns stay in the set.
SELECT
  CAST(CAMPAIGN_ID AS STRING) AS campaign_id,
  ARRAY_AGG(CAMPAIGN_NAME ORDER BY DATE DESC LIMIT 1)[OFFSET(0)] AS campaign_name,
  MIN(DATE) AS first_date,
  MAX(DATE) AS last_date
FROM `{{dataset}}.asaya_data_room_487110_GOOGLEADS_CONSOLIDATED`
WHERE CAMPAIGN_ID IS NOT NULL
GROUP BY campaign_id
