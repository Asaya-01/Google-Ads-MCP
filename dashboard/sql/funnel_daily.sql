-- GoKwik checkout funnel. The historical S3 report runs from 30 Apr to 26 Oct
-- 2026; the mail CSV from 27 Oct on. For any date the mail CSV covers, only
-- the mail CSV is used, so a day is never assembled from both reports.
-- Rows are then de-duplicated on the composite key.
WITH mail AS (
  SELECT
    Date, UTM_Source, UTM_Medium, UTM_Campaign, UTM_Content, UTM_Term, Landing_Page, Origin_Referrer,
    Checkout_Started, Address_Landed, Payment_Step_Reached, Sessions_Converted
  FROM `{{dataset}}.Asaya_Gokwik_Analytics_Funnel_Report_csv_from_mail`
),
hist AS (
  SELECT
    Date, UTM_Source, UTM_Medium, UTM_Campaign, UTM_Content, UTM_Term, Landing_Page, Origin_Referrer,
    Checkout_Started, Address_Landed, Payment_Step_Reached, Sessions_Converted
  FROM `{{dataset}}.Asaya_Funnel_report_Historical_S3_Gokwik_Checkout_Analytics_Funne_Report_Historical`
  WHERE Date NOT IN (SELECT DISTINCT Date FROM mail)
),
unioned AS (
  SELECT * FROM mail
  UNION ALL
  SELECT * FROM hist
),
dedup AS (
  SELECT *
  FROM unioned
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY Date, IFNULL(UTM_Source, ''), IFNULL(UTM_Medium, ''), IFNULL(UTM_Campaign, ''),
      IFNULL(UTM_Content, ''), IFNULL(UTM_Term, ''), IFNULL(Landing_Page, ''), IFNULL(Origin_Referrer, '')
    ORDER BY Date
  ) = 1
)
SELECT
  SAFE.PARSE_DATE('%Y-%m-%d', Date) AS date,
  LOWER(TRIM(IFNULL(UTM_Source, ''))) AS utm_source,
  LOWER(TRIM(IFNULL(UTM_Medium, ''))) AS utm_medium,
  TRIM(IFNULL(UTM_Campaign, '')) AS utm_campaign,
  IFNULL(REGEXP_EXTRACT(IFNULL(Landing_Page, ''), r'^(?:https?://[^/]+)?([^?#]*)'), '') AS landing_page,
  SUM(SAFE_CAST(Checkout_Started AS INT64)) AS checkout_started,
  SUM(SAFE_CAST(Address_Landed AS INT64)) AS address_landed,
  SUM(SAFE_CAST(Payment_Step_Reached AS INT64)) AS payment_step_reached,
  SUM(SAFE_CAST(Sessions_Converted AS INT64)) AS converted
FROM dedup
WHERE SAFE.PARSE_DATE('%Y-%m-%d', Date) BETWEEN @start_date AND @end_date
GROUP BY date, utm_source, utm_medium, utm_campaign, landing_page
