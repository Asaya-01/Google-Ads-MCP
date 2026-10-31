-- GoKwik checkout funnel per day, using the LATEST load of each day, with the
-- time that load landed in BigQuery. This is what the live tab reads: if the
-- bot reloads today's report every 30 minutes (each load holding the day so
-- far), the newest load wins and its age is shown on screen. Days before the
-- mail CSV started come from the historical report, which has no load time.
WITH mail AS (
  SELECT Date, Checkout_Started, Address_Landed, Payment_Step_Reached, Sessions_Converted,
         _airbyte_emitted_at AS loaded_at
  FROM `{{dataset}}.Asaya_Gokwik_Analytics_Funnel_Report_csv_from_mail`
  QUALIFY _airbyte_emitted_at >= TIMESTAMP_SUB(MAX(_airbyte_emitted_at) OVER (PARTITION BY Date), INTERVAL 10 MINUTE)
),
hist AS (
  SELECT Date, Checkout_Started, Address_Landed, Payment_Step_Reached, Sessions_Converted,
         CAST(NULL AS TIMESTAMP) AS loaded_at
  FROM `{{dataset}}.Asaya_Funnel_report_Historical_S3_Gokwik_Checkout_Analytics_Funne_Report_Historical`
  WHERE Date NOT IN (SELECT DISTINCT Date FROM mail)
),
unioned AS (
  SELECT * FROM mail
  UNION ALL
  SELECT * FROM hist
)
SELECT
  SAFE.PARSE_DATE('%Y-%m-%d', Date) AS date,
  SUM(SAFE_CAST(Checkout_Started AS INT64)) AS checkout_started,
  SUM(SAFE_CAST(Address_Landed AS INT64)) AS address_landed,
  SUM(SAFE_CAST(Payment_Step_Reached AS INT64)) AS payment_step_reached,
  SUM(SAFE_CAST(Sessions_Converted AS INT64)) AS converted,
  MAX(loaded_at) AS loaded_at
FROM unioned
WHERE SAFE.PARSE_DATE('%Y-%m-%d', Date) BETWEEN @start_date AND @end_date
GROUP BY date
