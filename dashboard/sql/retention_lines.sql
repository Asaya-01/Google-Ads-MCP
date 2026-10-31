-- Every counted order line for the retention census, all time, up to D-1.
-- Valid orders only (same rule as the rest of the dashboard) and only orders
-- with a Shopify customer id. Only IDs, titles, SKUs and amounts leave this
-- query: no names, emails or phone numbers are selected anywhere.
-- Lines of the same title in one order are summed (quantity does not matter).
WITH latest AS (
  SELECT *
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
valid_orders AS (
  SELECT
    CAST(id AS STRING) AS order_id,
    JSON_VALUE(customer, '$.id') AS customer_id,
    created_at AS ts
  FROM latest
  WHERE test = FALSE
    AND cancelled_at IS NULL
    AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex)
    AND JSON_VALUE(customer, '$.id') IS NOT NULL
    AND DATE(created_at, 'Asia/Kolkata') <= @through
),
products AS (
  SELECT CAST(id AS STRING) AS product_id, LOWER(TRIM(IFNULL(product_type, ''))) AS product_type
  FROM `{{dataset}}.Shopify_All_products`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
lines AS (
  SELECT
    v.order_id,
    v.customer_id,
    v.ts,
    IFNULL(i.PRODUCT_NAME, '') AS title,
    IFNULL(i.SKU, '') AS sku,
    IF(p.product_id IS NULL, '(no product match)', p.product_type) AS product_type,
    i.TOTAL_SALES AS revenue
  FROM `{{dataset}}.Shopify_All_orders_items` i
  JOIN valid_orders v ON v.order_id = i.ORDER_ID
  LEFT JOIN products p ON p.product_id = i.PRODUCT_ID
  QUALIFY ROW_NUMBER() OVER (PARTITION BY i.LINE_ITEM_ID ORDER BY i.ORDER_TIMESTAMP DESC) = 1
)
SELECT order_id, customer_id, ts, title, sku, product_type, SUM(revenue) AS revenue
FROM lines
GROUP BY order_id, customer_id, ts, title, sku, product_type
