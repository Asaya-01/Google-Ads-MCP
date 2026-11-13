-- Awareness: geo-trackable sales per day, state, city cluster and channel.
-- Read-only over Maplemonk's consolidated sales (nothing is written to
-- BigQuery). The owner's tested logic, unchanged except that the city ->
-- cluster mapping and the state spellings come from config (awareness.city_clusters,
-- awareness.state_aliases), passed in as arrays, and the dates are parameters.
--   Channels with customer geo only: WEBSITE (never SHOPIFY, an OMS
--   duplicate), AMAZON 3P, FLIPKART, MYNTRA, BLINKIT, ZEPTO, SWIGGYINSTAMART,
--   CRED_IMMD. Sell-in channels (Nykaa, Amazon 1P, B2B) have no customer geo,
--   so every lift built on this is a floor.
WITH base AS (
  SELECT
    Order_Date_1 AS order_date,
    marketplace  AS channel,
    ORDER_ID     AS order_id,
    NULLIF(NULLIF(UPPER(TRIM(State)), ''), 'NA') AS state_raw,
    NULLIF(NULLIF(UPPER(TRIM(CITY)),  ''), 'NA') AS city_raw,
    REGEXP_EXTRACT(CAST(pincode AS STRING), r'(\d{6})') AS pin,
    COALESCE(QUANTITY, 0)      AS units,
    COALESCE(SELLING_PRICE, 0) AS sales,
    new_customer_flag
  FROM `{{dataset}}.asaya_data_room_487110_sales_consolidated`
  WHERE Order_Date_1 BETWEEN @start_date AND @end_date
    AND marketplace IN UNNEST(@channels)
    AND UPPER(COALESCE(ORDER_STATUS, '')) != 'CANCELLED'
    AND NOT REGEXP_CONTAINS(UPPER(COALESCE(reference_code, '')), r'^ASAYA(INF|SS)')
    AND UPPER(COALESCE(PRODUCT_CATEGORY, '')) NOT IN ('FREEBIE', 'MERCH')
),
smap AS (
  SELECT k, v FROM UNNEST(@state_key) AS k WITH OFFSET i JOIN UNNEST(@state_name) AS v WITH OFFSET j ON i = j
),
cleaned AS (
  SELECT b.* EXCEPT(state_raw),
    -- letters-only spelling -> state (config awareness.state_aliases); a state outside India drops out of geo
    IF(b.state_raw IN UNNEST(@not_india), NULL, COALESCE(sm.v, b.state_raw)) AS state_clean
  FROM base b
  LEFT JOIN smap sm ON sm.k = REGEXP_REPLACE(b.state_raw, r'[^A-Z]', '')
),
pin_dict AS (
  SELECT pin,
    APPROX_TOP_COUNT(state_clean, 1)[OFFSET(0)].value AS pin_state,
    APPROX_TOP_COUNT(city_raw, 1)[OFFSET(0)].value    AS pin_city
  FROM cleaned
  WHERE channel = 'WEBSITE' AND pin IS NOT NULL AND state_clean IS NOT NULL AND city_raw IS NOT NULL
  GROUP BY pin
),
city_dict AS (
  SELECT city_raw, APPROX_TOP_COUNT(state_clean, 1)[OFFSET(0)].value AS city_state
  FROM cleaned
  WHERE state_clean IS NOT NULL AND city_raw IS NOT NULL
  GROUP BY city_raw
),
resolved AS (
  SELECT c.order_date, c.channel, c.order_id, c.units, c.sales, c.new_customer_flag,
    COALESCE(c.city_raw, p.pin_city)                   AS city,
    COALESCE(c.state_clean, p.pin_state, d.city_state) AS state
  FROM cleaned c
  LEFT JOIN pin_dict  p ON p.pin = c.pin
  LEFT JOIN city_dict d ON d.city_raw = COALESCE(c.city_raw, p.pin_city)
),
cmap AS (
  SELECT raw, name FROM UNNEST(@cluster_raw) AS raw WITH OFFSET i JOIN UNNEST(@cluster_name) AS name WITH OFFSET j ON i = j
),
clustered AS (
  SELECT r.*,
    CASE
      WHEN m.name = 'DELHI' AND COALESCE(r.state, 'DELHI') != 'DELHI' THEN r.city  -- a "WEST" zone outside Delhi stays itself
      ELSE COALESCE(m.name, r.city)
    END AS city_cluster
  FROM resolved r
  LEFT JOIN cmap m ON m.raw = r.city
)
SELECT
  order_date,
  COALESCE(state, 'UNKNOWN')        AS state,
  COALESCE(city_cluster, 'UNKNOWN') AS city_cluster,
  channel,
  CASE WHEN channel = 'WEBSITE' THEN 'D2C'
       WHEN channel IN ('BLINKIT','ZEPTO','SWIGGYINSTAMART') THEN 'QUICK_COMMERCE'
       ELSE 'MARKETPLACE' END     AS channel_group,
  COUNT(DISTINCT order_id)        AS orders,
  SUM(units)                      AS units,
  ROUND(SUM(sales), 2)            AS sales,
  COUNT(DISTINCT IF(channel = 'WEBSITE' AND new_customer_flag = 'New', order_id, NULL)) AS d2c_new_customer_orders
FROM clustered
GROUP BY 1, 2, 3, 4, 5
