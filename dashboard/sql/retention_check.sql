-- Independent totals for the retention census to be checked against:
-- every real order, the valid ones, and the customers behind them.
WITH latest AS (
  SELECT *
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
real AS (
  SELECT *
  FROM latest
  WHERE test = FALSE AND DATE(created_at, 'Asia/Kolkata') <= @through
)
SELECT
  COUNT(DISTINCT id) AS orders_all,
  COUNT(DISTINCT IF(
    cancelled_at IS NULL AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex),
    id, NULL)) AS orders_valid,
  COUNT(DISTINCT IF(
    cancelled_at IS NULL AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex),
    JSON_VALUE(customer, '$.id'), NULL)) AS customers_valid,
  COUNT(DISTINCT IF(
    cancelled_at IS NULL AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex)
      AND JSON_VALUE(customer, '$.id') IS NULL,
    id, NULL)) AS orders_without_customer
FROM real
