-- Line items on valid orders, aggregated per day and product, with the reason
-- a line is treated as a freebie (NULL = kept). The app drops freebie lines
-- from units and product tables and logs how many lines each rule caught.
--
-- Freebie rules, first match wins:
--   product_type  product type is in @freebie_types (merch, freebie)
--   minis         title or SKU matches @minis_regex, and the unit price is at
--                 most @minis_max_unit_price (NULL disables the price guard).
--                 The guard exists because paid kits such as "Travel Kit
--                 (4 minis + Pouch)" share a SKU with the free gift version.
--   safety_net    title matches @safety_net_regex (charm, mesh bag, tote bag)
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
    IFNULL(p.product_type, '') AS product_type,
    i.QUANTITY AS quantity,
    i.TOTAL_SALES AS revenue,
    i.LINE_ITEM_SALES AS gross_sales,
    SAFE_DIVIDE(i.LINE_ITEM_SALES, NULLIF(i.QUANTITY, 0)) AS unit_price,
    REGEXP_CONTAINS(LOWER(CONCAT(IFNULL(i.PRODUCT_NAME, ''), ' ', IFNULL(i.SKU, ''))), @minis_regex) AS is_minis
  FROM `{{dataset}}.Shopify_All_orders_items` i
  JOIN valid_orders v ON v.order_id = i.ORDER_ID
  LEFT JOIN products p ON p.product_id = i.PRODUCT_ID
  QUALIFY ROW_NUMBER() OVER (PARTITION BY i.LINE_ITEM_ID ORDER BY i.ORDER_TIMESTAMP DESC) = 1
),
classified AS (
  SELECT
    *,
    CASE
      WHEN product_type IN UNNEST(@freebie_types) THEN 'product_type'
      WHEN is_minis AND (@minis_max_unit_price IS NULL OR IFNULL(unit_price, 0) <= @minis_max_unit_price) THEN 'minis'
      WHEN REGEXP_CONTAINS(LOWER(product_title), @safety_net_regex) THEN 'safety_net'
    END AS drop_reason
  FROM lines
)
SELECT
  date,
  product_id,
  sku,
  ANY_VALUE(product_title) AS product_title,
  product_type,
  drop_reason,
  is_minis AND drop_reason IS NULL AS paid_minis_kept,
  COUNT(*) AS line_count,
  SUM(quantity) AS units,
  SUM(revenue) AS revenue,
  SUM(gross_sales) AS gross_sales
FROM classified
GROUP BY date, product_id, sku, product_type, drop_reason, paid_minis_kept
