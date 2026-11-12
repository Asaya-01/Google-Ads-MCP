-- Dashboard Plus · M3. GA4 purchases per day and session source / medium:
-- each transaction once (the loader repeats some transaction rows).
WITH tx AS (
  SELECT
    PARSE_DATE('%Y%m%d', date) AS date,
    LOWER(IFNULL(sessionSource, '(not set)')) AS source,
    LOWER(IFNULL(sessionMedium, '(not set)')) AS medium,
    transactionId,
    grossPurchaseRevenue AS revenue
  FROM `{{dataset}}.GA4_GA4_asaya_orders_by_source`
  WHERE CAST(property_id AS STRING) = @property
    AND PARSE_DATE('%Y%m%d', date) BETWEEN @start_date AND @end_date
    AND transactionId IS NOT NULL AND transactionId NOT IN ('', '(not set)')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY transactionId ORDER BY date, source, medium) = 1
)
SELECT date, CONCAT(source, ' / ', medium) AS source_medium, COUNT(*) AS purchases, SUM(revenue) AS revenue
FROM tx
GROUP BY 1, 2
