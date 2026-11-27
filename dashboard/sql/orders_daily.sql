-- Daily GMV and orders. GMV = Shopify "Total sales" at order level = total_price
-- on valid orders. Refunds and returns are not subtracted.
-- New vs repeat: an order is "new" when it is the customer's first valid order.
-- App orders: tagged mobile_app_ios / mobile_app_android by the app; the same
-- numbers are given per app platform (web = the totals minus these).
WITH latest AS (
  SELECT *
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
valid_orders AS (
  SELECT
    id,
    total_price,
    created_at,
    DATE(created_at, 'Asia/Kolkata') AS order_date,
    JSON_VALUE(customer, '$.id') AS customer_id,
    REGEXP_EXTRACT(LOWER(IFNULL(tags, '')), r'mobile_app_(ios|android)') AS app
  FROM latest
  WHERE test = FALSE
    AND cancelled_at IS NULL
    AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex)
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at, id) AS customer_order_n
  FROM valid_orders
)
SELECT
  order_date AS date,
  COUNT(DISTINCT id) AS orders,
  SUM(total_price) AS gmv,
  COUNT(DISTINCT IF(customer_id IS NOT NULL AND customer_order_n = 1, id, NULL)) AS new_orders,
  COUNT(DISTINCT IF(customer_id IS NOT NULL AND customer_order_n > 1, id, NULL)) AS repeat_orders,
  SUM(IF(customer_id IS NOT NULL AND customer_order_n = 1, total_price, 0)) AS new_gmv,
  SUM(IF(customer_id IS NOT NULL AND customer_order_n > 1, total_price, 0)) AS repeat_gmv,
  COUNT(DISTINCT IF(app = 'ios', id, NULL)) AS orders_app_ios,
  SUM(IF(app = 'ios', total_price, 0)) AS gmv_app_ios,
  COUNT(DISTINCT IF(app = 'ios' AND customer_id IS NOT NULL AND customer_order_n = 1, id, NULL)) AS new_orders_app_ios,
  COUNT(DISTINCT IF(app = 'ios' AND customer_id IS NOT NULL AND customer_order_n > 1, id, NULL)) AS repeat_orders_app_ios,
  SUM(IF(app = 'ios' AND customer_id IS NOT NULL AND customer_order_n = 1, total_price, 0)) AS new_gmv_app_ios,
  SUM(IF(app = 'ios' AND customer_id IS NOT NULL AND customer_order_n > 1, total_price, 0)) AS repeat_gmv_app_ios,
  COUNT(DISTINCT IF(app = 'android', id, NULL)) AS orders_app_android,
  SUM(IF(app = 'android', total_price, 0)) AS gmv_app_android,
  COUNT(DISTINCT IF(app = 'android' AND customer_id IS NOT NULL AND customer_order_n = 1, id, NULL)) AS new_orders_app_android,
  COUNT(DISTINCT IF(app = 'android' AND customer_id IS NOT NULL AND customer_order_n > 1, id, NULL)) AS repeat_orders_app_android,
  SUM(IF(app = 'android' AND customer_id IS NOT NULL AND customer_order_n = 1, total_price, 0)) AS new_gmv_app_android,
  SUM(IF(app = 'android' AND customer_id IS NOT NULL AND customer_order_n > 1, total_price, 0)) AS repeat_gmv_app_android
FROM ranked
WHERE order_date BETWEEN @start_date AND @end_date
GROUP BY date
ORDER BY date
