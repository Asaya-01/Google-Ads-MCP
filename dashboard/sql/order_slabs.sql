-- Basket size ("slab") per day: how many orders had 1, 2, 3, 4 or 5+ items.
-- Items are the kept order lines only: lines whose product type is in
-- @exclude_product_types (freebie, merch, book, gummies, blank) do not count,
-- so a free gift never turns a buy-one into a buy-two. Orders that are tests,
-- cancelled, ASAYASS samples or ASAYAINF influencer orders are left out, as
-- everywhere else. An order whose lines are all excluded has 0 items (slab 0):
-- kept in the count so the day still ties to the order total, shown apart.
--
-- sales = the kept lines' TOTAL_SALES (what the Shopify "Orders over time"
-- report shows with the same filters). gmv = the order total_price, for
-- tying to the Overview.
WITH latest AS (
  SELECT *
  FROM `{{dataset}}.Shopify_All_orders`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
),
valid_orders AS (
  SELECT
    CAST(id AS STRING) AS order_id,
    total_price,
    DATE(created_at, 'Asia/Kolkata') AS order_date
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
    i.ORDER_ID AS order_id,
    i.QUANTITY AS quantity,
    i.TOTAL_SALES AS revenue,
    IF(p.product_id IS NULL, '(no product match)', p.product_type) AS product_type
  FROM `{{dataset}}.Shopify_All_orders_items` i
  JOIN valid_orders v ON v.order_id = i.ORDER_ID
  LEFT JOIN products p ON p.product_id = i.PRODUCT_ID
  QUALIFY ROW_NUMBER() OVER (PARTITION BY i.LINE_ITEM_ID ORDER BY i.ORDER_TIMESTAMP DESC) = 1
),
per_order AS (
  SELECT
    v.order_id,
    v.order_date,
    v.total_price,
    IFNULL(SUM(IF(l.product_type NOT IN UNNEST(@exclude_product_types), l.quantity, 0)), 0) AS kept_qty,
    IFNULL(SUM(IF(l.product_type NOT IN UNNEST(@exclude_product_types), l.revenue, 0)), 0) AS kept_sales
  FROM valid_orders v
  LEFT JOIN lines l ON l.order_id = v.order_id
  GROUP BY v.order_id, v.order_date, v.total_price
)
SELECT
  order_date AS date,
  LEAST(CAST(kept_qty AS INT64), 5) AS slab,
  COUNT(*) AS orders,
  SUM(kept_qty) AS units,
  SUM(kept_sales) AS sales,
  SUM(total_price) AS gmv
FROM per_order
GROUP BY date, slab
ORDER BY date, slab
