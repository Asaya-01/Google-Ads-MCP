-- Line items on valid orders, aggregated per day and product. A line is
-- excluded from units and product tables when its product type is in
-- @exclude_product_types (freebie, merch, book, gummies, blank); drop_reason
-- is then 'product_type', otherwise NULL (kept).
--
-- Lines whose product no longer exists in Shopify_All_products get the type
-- '(no product match)', so they are never mistaken for the blank type.
--
-- Revenue = TOTAL_SALES, which sums to the order total_price (GMV).
WITH latest AS (
  SELECT *
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
valid_orders AS (
  SELECT CAST(id AS STRING) AS order_id
  FROM latest
  WHERE test = FALSE
    AND cancelled_at IS NULL
    AND NOT REGEXP_CONTAINS(UPPER(name), @exclude_name_regex)
    AND DATE(created_at, 'Asia/Kolkata') BETWEEN @start_date AND @end_date
),
products AS (
  SELECT CAST(id AS STRING) AS product_id, LOWER(TRIM(IFNULL(product_type, ''))) AS product_type
  FROM `{{dataset}}.Shopify_All_products`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
lines AS (
  SELECT
    DATE(i.ORDER_TIMESTAMP) AS date,  -- ORDER_TIMESTAMP is already IST
    i.PRODUCT_ID AS product_id,
    IFNULL(i.SKU, '') AS sku,
    IFNULL(i.PRODUCT_NAME, '') AS product_title,
    IF(p.product_id IS NULL, '(no product match)', p.product_type) AS product_type,
    i.QUANTITY AS quantity,
    i.TOTAL_SALES AS revenue,
    i.LINE_ITEM_SALES AS gross_sales
  FROM `{{dataset}}.Shopify_All_orders_items` i
  JOIN valid_orders v ON v.order_id = i.ORDER_ID
  LEFT JOIN products p ON p.product_id = i.PRODUCT_ID
  QUALIFY ROW_NUMBER() OVER (PARTITION BY i.LINE_ITEM_ID ORDER BY i.ORDER_TIMESTAMP DESC) = 1
),
classified AS (
  SELECT
    *,
    IF(product_type IN UNNEST(@exclude_product_types), 'product_type', NULL) AS drop_reason
  FROM lines
)
SELECT
  date,
  product_id,
  sku,
  ANY_VALUE(product_title) AS product_title,
  product_type,
  drop_reason,
  COUNT(*) AS line_count,
  SUM(quantity) AS units,
  SUM(revenue) AS revenue,
  SUM(gross_sales) AS gross_sales
FROM classified
GROUP BY date, product_id, sku, product_type, drop_reason
