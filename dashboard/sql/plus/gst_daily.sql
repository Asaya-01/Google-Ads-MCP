-- Dashboard Plus · M1. GST Shopify charged per day on valid orders (the same
-- rules as Total sales: no tests, no cancelled orders, no ASAYAINF / ASAYASS),
-- read-only. Used as a share: GST on Total sales = Total sales x tax / total.
WITH latest AS (
  SELECT id, name, test, cancelled_at, created_at, total_price, total_tax
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
)
SELECT
  DATE(created_at, 'Asia/Kolkata') AS date,
  SUM(total_price) AS total_price,
  SUM(IFNULL(total_tax, 0)) AS total_tax
FROM latest
WHERE test = FALSE
  AND cancelled_at IS NULL
  AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex)
  AND DATE(created_at, 'Asia/Kolkata') BETWEEN @start_date AND @end_date
GROUP BY date
ORDER BY date
