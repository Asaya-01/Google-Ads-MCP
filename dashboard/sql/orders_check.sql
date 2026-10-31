-- Orders created on one IST day, any status except test orders, on the latest
-- version of each order. This is the figure Shopify itself reports for the
-- same day, so it checks the BigQuery copy for completeness.
SELECT COUNT(DISTINCT id) AS orders
FROM (
  SELECT id
  FROM `{{dataset}}.Shopify_All_orders`
  WHERE created_at >= TIMESTAMP(@d1, 'Asia/Kolkata')
    AND created_at < TIMESTAMP(DATE_ADD(@d1, INTERVAL 1 DAY), 'Asia/Kolkata')
    AND IFNULL(test, FALSE) = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
)
