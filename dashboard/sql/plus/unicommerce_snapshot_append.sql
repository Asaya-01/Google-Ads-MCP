-- Dashboard Plus · M7. Today's copy of the Unicommerce stock snapshot (the
-- source table is overwritten upstream every day, so its history is kept
-- here). Run as a query whose destination is dashboard_plus, append only.
SELECT
  CURRENT_DATE('Asia/Kolkata') AS snapshot_date,
  CURRENT_TIMESTAMP() AS taken_at,
  CAST(skuCode AS STRING) AS sku,
  CAST(name AS STRING) AS name,
  CAST(facility AS STRING) AS facility,
  SAFE_CAST(inventory AS INT64) AS inventory,
  SAFE_CAST(openSale AS INT64) AS open_sale,
  SAFE_CAST(openPurchase AS INT64) AS open_purchase,
  SAFE_CAST(putawayPending AS INT64) AS putaway_pending,
  SAFE_CAST(pendingInventoryAssessment AS INT64) AS pending_assessment,
  SAFE_CAST(pendingStockTransfer AS INT64) AS pending_transfer,
  SAFE_CAST(vendorInventory AS INT64) AS vendor_inventory,
  SAFE_CAST(virtualInventory AS INT64) AS virtual_inventory,
  CAST(timeStamp AS STRING) AS source_timestamp
FROM `{{dataset}}.{{unicommerce_source}}`
