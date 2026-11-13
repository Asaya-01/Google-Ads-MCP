-- Awareness acceptance check 1: WEBSITE distinct orders in a week, before and
-- after the exclusions (cancelled, ASAYAINF / ASAYASS, freebie / merch lines).
-- Read-only.
SELECT
  COUNT(DISTINCT ORDER_ID) AS raw_orders,
  COUNT(DISTINCT IF(UPPER(COALESCE(ORDER_STATUS, '')) != 'CANCELLED'
                    AND NOT REGEXP_CONTAINS(UPPER(COALESCE(reference_code, '')), r'^ASAYA(INF|SS)')
                    AND UPPER(COALESCE(PRODUCT_CATEGORY, '')) NOT IN ('FREEBIE', 'MERCH'), ORDER_ID, NULL)) AS kept_orders,
  COUNT(DISTINCT IF(UPPER(COALESCE(ORDER_STATUS, '')) = 'CANCELLED', ORDER_ID, NULL)) AS cancelled_orders
FROM `{{dataset}}.asaya_data_room_487110_sales_consolidated`
WHERE Order_Date_1 BETWEEN @start_date AND @end_date AND marketplace = 'WEBSITE'
