-- Valid orders with the UTM GoKwik captured at checkout, for the source and
-- campaign drill-downs. The UTM fields on Shopify_All_orders read DIRECT for
-- almost every recent order, so GoKwik is the attribution source. Orders
-- GoKwik has no record of come back with in_gokwik = FALSE. Landing page is
-- not available per order (landing_site reads "/" after the GoKwik checkout);
-- the landing-page drill-down uses the GoKwik funnel instead.
WITH latest AS (
  SELECT *
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
valid_orders AS (
  SELECT
    id,
    name,
    total_price,
    DATE(created_at, 'Asia/Kolkata') AS order_date
  FROM latest
  WHERE test = FALSE
    AND cancelled_at IS NULL
    AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex)
    AND DATE(created_at, 'Asia/Kolkata') BETWEEN @start_date AND @end_date
),
gokwik AS (
  SELECT Shopify_Order_Name, Utm_Source, Utm_Medium, Utm_Campaign, 1 AS priority
  FROM `{{dataset}}.Asaya_Gokwik_Orders_report_csv_from_mail`
  UNION ALL
  SELECT Shopify_Order_Name, Utm_Source, Utm_Medium, Utm_Campaign, 2 AS priority
  FROM `{{dataset}}.Asaya_Gokwik_Orders_Historical_S3_Gokwik_Orders_report`
),
gk AS (
  SELECT *
  FROM gokwik
  QUALIFY ROW_NUMBER() OVER (PARTITION BY Shopify_Order_Name ORDER BY priority) = 1
)
SELECT
  o.order_date AS date,
  gk.Shopify_Order_Name IS NOT NULL AS in_gokwik,
  LOWER(TRIM(IFNULL(gk.Utm_Source, ''))) AS utm_source,
  LOWER(TRIM(IFNULL(gk.Utm_Medium, ''))) AS utm_medium,
  TRIM(IFNULL(gk.Utm_Campaign, '')) AS utm_campaign,
  COUNT(DISTINCT o.id) AS orders,
  SUM(o.total_price) AS gmv
FROM valid_orders o
LEFT JOIN gk ON gk.Shopify_Order_Name = o.name
GROUP BY date, in_gokwik, utm_source, utm_medium, utm_campaign
