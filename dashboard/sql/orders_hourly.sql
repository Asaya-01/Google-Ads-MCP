-- Orders and GMV per IST hour for complete past days: the baseline the live
-- tab compares today against. Same valid-order rule as orders_daily.sql
-- (not test, not cancelled, not a sample or influencer order).
WITH latest AS (
  SELECT *
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
)
SELECT
  DATE(created_at, 'Asia/Kolkata') AS date,
  EXTRACT(HOUR FROM DATETIME(created_at, 'Asia/Kolkata')) AS hour,
  COUNT(DISTINCT id) AS orders,
  SUM(total_price) AS gmv
FROM latest
WHERE test = FALSE
  AND cancelled_at IS NULL
  AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex)
  AND DATE(created_at, 'Asia/Kolkata') BETWEEN @start_date AND @end_date
GROUP BY date, hour
