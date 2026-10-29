-- Is D-1 present in every BigQuery source? One row per source.
SELECT
  'shopify_orders' AS source,
  MAX(DATE(created_at, 'Asia/Kolkata')) AS latest_date,
  COUNTIF(DATE(created_at, 'Asia/Kolkata') = @d1) AS d1_rows
FROM `{{dataset}}.Shopify_All_orders`
WHERE created_at >= TIMESTAMP(DATE_SUB(@d1, INTERVAL 10 DAY), 'Asia/Kolkata')
UNION ALL
SELECT
  'shopify_order_items',
  MAX(DATE(ORDER_TIMESTAMP)),
  COUNTIF(DATE(ORDER_TIMESTAMP) = @d1)
FROM `{{dataset}}.Shopify_All_orders_items`
WHERE ORDER_TIMESTAMP >= DATETIME(DATE_SUB(@d1, INTERVAL 10 DAY))
UNION ALL
SELECT
  'gokwik_funnel',
  MAX(SAFE.PARSE_DATE('%Y-%m-%d', Date)),
  COUNTIF(SAFE.PARSE_DATE('%Y-%m-%d', Date) = @d1)
FROM (
  SELECT Date FROM `{{dataset}}.Asaya_Gokwik_Analytics_Funnel_Report_csv_from_mail`
  UNION ALL
  SELECT Date FROM `{{dataset}}.Asaya_Funnel_report_Historical_S3_Gokwik_Checkout_Analytics_Funne_Report_Historical`
)
UNION ALL
SELECT
  'gokwik_orders',
  MAX(DATE(SAFE.PARSE_DATETIME('%d/%m/%Y %I:%M %p', Created_At))),
  COUNTIF(DATE(SAFE.PARSE_DATETIME('%d/%m/%Y %I:%M %p', Created_At)) = @d1)
FROM (
  SELECT Created_At FROM `{{dataset}}.Asaya_Gokwik_Orders_report_csv_from_mail`
  UNION ALL
  SELECT Created_At FROM `{{dataset}}.Asaya_Gokwik_Orders_Historical_S3_Gokwik_Orders_report`
)
UNION ALL
SELECT
  'google_ads',
  MAX(DATE),
  COUNTIF(DATE = @d1)
FROM `{{dataset}}.asaya_data_room_487110_GOOGLEADS_CONSOLIDATED`
WHERE DATE >= DATE_SUB(@d1, INTERVAL 10 DAY)
