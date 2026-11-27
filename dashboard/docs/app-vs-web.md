# App vs Web, pacing, cost per new customer

## How an app order is identified (checked against Shopify and BigQuery)

The app marks every order it places two ways:
- the order tag `mobile_app_ios` or `mobile_app_android`;
- the order attributes `source=app`, `platform=ios|android`, `tag=mobile_app_<platform>`.

App orders check out through GoKwik like the website, so Shopify files them under the same "World of Asaya: Gokwik" sales channel. Only the tag tells them apart. The dashboard uses the tag:

| Source | How the split is read |
|---|---|
| Shopify sales report (Orders, Total sales) | `FROM sales … WHERE order_tags CONTAINS 'mobile_app_ios'` (and `_android`), one pull per tag per refresh |
| BigQuery orders (orders, GMV, new and repeat customers) | `sql/orders_daily.sql` reads the same tag from `Shopify_All_orders.tags` (read-only; the existing columns are unchanged) |

- **Web** = the store's totals minus the app's, so Web + App always equals All.
- **App** = iOS + Android.
- Counts were checked: Shopify's report and BigQuery agree on the number of app orders.

## What each view can show

| | All | Web | App / iOS app / Android app |
|---|---|---|---|
| Orders, Total sales, AOV | ✓ | ✓ | ✓ |
| New / repeat customers | ✓ | ✓ | ✓ |
| Sessions, CVR, Perf CVR, ATC, checkout steps | ✓ | ✓ (website sessions; CVR = web orders ÷ web sessions) | – Shopify records no app sessions: needs the app's own analytics |
| Spend, ROAS, CPS, cost per new customer | ✓ | – spend is not split by channel | – |
| Channel / campaign / product tables | all orders (a note says so when App or Web is picked) | | |

Two caveats:
- **CVR in the All view** divides all orders, app ones included, by website sessions, because app sessions don't exist in Shopify. The Web view is the clean website conversion rate.
- **GoKwik's checkout counts may include app checkouts**: GoKwik doesn't tag them. On the Funnel tab this is about 1% of checkouts.

The switch sits in the date bar on Overview, Funnel, Marketing and Products. Cards, trends and "Why it moved" all follow it; a number with no split shows the reason instead.

## Month pacing (Overview)

- **Actuals:** Shopify's Total sales and Performance spend from the first of the month to the last full day.
- **Plan:** the media plan's Target vs Achieved tab, day by day.
- **Projection:** month-to-date actual + (the plan's remaining days × the month-to-date achievement rate). Planned sale days keep their size.
- **Also shown:** the sales needed per remaining day, projected spend and ROAS against plan.
- **Scope:** whole store only, because the plan is not split by app vs web.

## Cost per new customer (Overview, next to ROAS)

- **Definition:** Performance spend ÷ new customers.
- **New customer:** an order that was the customer's first valid order ever. Valid means not test, cancelled, sample or influencer, with a Shopify customer ID. This is the rule the Overview's New-customer orders already used (see `dashboard-audit.md` §12).
- **Unclassed orders:** orders with no customer ID can't be classed. The card shows what share of orders that is.
- **Scope:** shown in the All view only, since spend is not split by channel.

## Why it moved: Products and Retention

- **Products:** the products behind the change in product revenue per day, whether volume (units) or price per unit drove it, products that nearly stopped selling (usually stock or listing), and concentration in one product.
- **Retention:** the repeat rate of customers new to Asaya in the picked dates against those won in the same number of days just before, at the longest milestone (90, 60 or 30 days) both groups have fully reached. Also shown: which first products moved it, and how far a shift in first-product mix explains the change.
