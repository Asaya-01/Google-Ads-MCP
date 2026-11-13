"""Made-up rows shaped like sql/awareness/geo_daily.sql's output, for the
Awareness tests: about a dozen states and city clusters, three channels, a
lift in Tamil Nadu from 1 Nov 2026 and a dip elsewhere (Top Funnel dark)."""

import datetime as dt
import math
import random

CITIES = [  # state, city, daily sales base (made-up round numbers, not Asaya's)
    ("TAMIL NADU", "CHENNAI METRO", 30000), ("TAMIL NADU", "COIMBATORE", 6000), ("TAMIL NADU", "MADURAI", 1000),
    ("KARNATAKA", "BENGALURU", 100000), ("KARNATAKA", "MYSURU", 5000), ("TELANGANA", "HYDERABAD", 50000),
    ("MAHARASHTRA", "MUMBAI", 80000), ("MAHARASHTRA", "PUNE", 40000), ("MAHARASHTRA", "THANE", 20000),
    ("DELHI", "DELHI", 90000), ("KERALA", "KOCHI", 10000), ("GUJARAT", "AHMEDABAD", 20000),
    ("WEST BENGAL", "KOLKATA", 20000), ("UTTAR PRADESH", "NOIDA", 20000), ("UTTAR PRADESH", "LUCKNOW", 10000),
    ("RAJASTHAN", "JAIPUR", 10000), ("PUNJAB", "LUDHIANA", 6000), ("HARYANA", "GURUGRAM", 30000),
    ("ASSAM", "GUWAHATI", 3000), ("ODISHA", "BHUBANESWAR", 3000), ("UNKNOWN", "UNKNOWN", 2000),
]
SPLIT = [("WEBSITE", "D2C", 0.55), ("AMAZON", "MARKETPLACE", 0.25), ("BLINKIT", "QUICK_COMMERCE", 0.20)]


def rows(start="2026-01-01", end="2026-11-12"):
    rnd = random.Random(7)
    d, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    out = []
    while d <= e:
        season = 1 + 0.15 * math.sin(d.timetuple().tm_yday / 58) + (0.35 if d.day in range(9, 15) or d.day in range(21, 26) else 0)
        for state, city, base in CITIES:
            lift = 1.0
            if d >= dt.date(2026, 11, 1):
                lift = 1.15 if state == "TAMIL NADU" else 0.95
            day = base * season * lift * rnd.uniform(0.85, 1.15)
            for ch, grp, share in SPLIT:
                sales = round(day * share, 2)
                orders = max(1, int(sales / 780))
                out.append({"order_date": d.isoformat(), "state": state, "city_cluster": city, "channel": ch, "channel_group": grp,
                            "orders": orders, "units": orders + orders // 4, "sales": sales,
                            "d2c_new_customer_orders": int(orders * 0.6) if ch == "WEBSITE" else 0})
        d += dt.timedelta(days=1)
    return out


def phases(start="2026-01-01", end="2026-11-12"):
    d, e, out = dt.date.fromisoformat(start), dt.date.fromisoformat(end), {}
    while d <= e:
        out[d.isoformat()] = "sale" if d.day in range(9, 15) or d.day in range(21, 26) else "bau"
        d += dt.timedelta(days=1)
    return out
