-- Google Ads spend and platform-reported results per campaign per day.
SELECT
  DATE AS date,
  CAST(CAMPAIGN_ID AS STRING) AS campaign_id,
  ANY_VALUE(CAMPAIGN_NAME) AS campaign_name,
  SUM(Spend) AS spend,
  SUM(Impressions) AS impressions,
  SUM(Clicks) AS clicks,
  SUM(Conversions) AS conversions,
  SUM(Conversion_Value) AS conversion_value
FROM `{{dataset}}.asaya_data_room_487110_GOOGLEADS_CONSOLIDATED`
WHERE DATE BETWEEN @start_date AND @end_date
  AND CAMPAIGN_ID IS NOT NULL
GROUP BY date, campaign_id
