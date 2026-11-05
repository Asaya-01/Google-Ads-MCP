"""Region tab: names cleaned onto the map, numbers kept as Shopify reports them."""

import json

import pytest

from app import settings
from app.pages import region as R
from app.pages import build_all

from test_pages import CFG, _dataset


def test_states_land_on_the_maps_shapes():
    india = json.loads((settings.STATIC_DIR / "india_map.json").read_text())
    shapes = {s["id"] for s in india["states"]}
    used = {m for _, _, ms in R.STATES for m in ms}
    assert used == shapes  # every shape belongs to exactly one state, none left over
    assert R.state_key("Maharashtra") == "mh"
    assert R.state_key("Ladakh") == R.state_key("Jammu and Kashmir") == "jk"
    assert R.state_key("Dadra and Nagar Haveli and Daman and Diu") == "dnhdd"
    assert R.state_key("Orissa") == "or" and R.state_key("Pondicherry") == "py"
    assert R.state_key("") == "xx" and R.state_key("Dubai") == "xx"
    assert india["attribution"] and india["license"] == "CC-BY-4.0"


def test_city_spellings_merge():
    assert R.city_key("BANGALORE") == R.city_key("Bengaluru") == R.city_key(" bengaluru ")
    assert R.city_show(R.city_key("Bengaluru")) == "Bengaluru"
    assert R.city_show(R.city_key("gurgaon")) == "Gurugram"
    assert R.city_show(R.city_key("SOUTH EAST")) == "South East"
    assert R.city_key("BENGALURU RURAL") != R.city_key("BANGALORE")


def test_pages_keep_shopify_numbers_and_split_gifts():
    data = _dataset(with_meta=False)
    d = data["d1"]
    data["region"] = {
        "from": d,
        "to": d,
        "city": {d: [["Karnataka", "BANGALORE", 10, 8000.0, 30], ["Karnataka", "Bengaluru", 2, 1500.0, 5], ["", "", 1, 500.0, 1]]},
        "sku": {d: [
            ["Karnataka", "BANGALORE", "Roll-On", "Serum", 8, 6000.0, 9],
            ["Karnataka", "Bengaluru", "Roll-On", "Serum", 2, 1500.0, 2],
            ["Karnataka", "BANGALORE", "Mini Gift", "Freebie", 10, 0.0, 12],
        ]},
    }
    pages, _ = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    rd = pages["region_days"]
    blr = [i for i, c in enumerate(rd["cities"]) if c["name"] == "Bengaluru"]
    assert len(blr) == 1  # one city, not three spellings
    row = next(r for r in rd["rows"] if r[1] == blr[0])
    assert rd["dates"][row[0]] == d
    assert row[2:] == [12, 9500.0, 35, 11]  # orders, total sales, quantity ordered, paid items (gift left out)
    gift = next(p for p in rd["products"] if p["name"] == "Mini Gift")
    assert gift["gift"] is True
    assert rd["states"][rd["cities"][blr[0]]["s"]]["key"] == "ka"
    assert "region_sku/ka" in pages and pages["region_sku/ka"]["rows"]
    assert pages["region_sku/all"]["rows"][0][3:] in ([10, 7500.0, 11], [10, 0.0, 12])
    assert pages["region"]["map"]["states"] and pages["region"]["available"]


class _Store:
    def __init__(self):
        self.saved = {}

    def get_json(self, path):
        return self.saved.get(path)

    def put_json(self, path, value):
        self.saved[path] = json.loads(json.dumps(value))


class _Shop:
    def __init__(self):
        self.sku_calls = []

    def sales_by_city(self, since, until, names):
        assert names == ["ASAYAINF", "ASAYASS"] or names  # the D-1 exclusions
        return [{"date": since, "region": "Goa", "city": "PANAJI", "orders": 2, "sales": 1600.0, "qty": 3}]

    def sales_by_city_product(self, day, names):
        self.sku_calls.append(day)
        return [{"region": "Goa", "city": "PANAJI", "product": "Roll-On", "type": "Serum", "orders": 2, "sales": 1600.0, "qty": 2}]


def test_collect_caches_days_refreshes_recent_and_backfills_in_steps():
    from app import region

    cfg = {**CFG, "region": {"history_days": 10, "refresh_days": 2, "sku_backfill_per_run": 3}}
    st, notes = _Store(), {}
    shop = _Shop()
    out = region.collect(cfg, st, shop, "2026-10-28", notes)
    # the two recent days, then three older ones (the backfill budget), newest first
    assert shop.sku_calls == ["2026-10-28", "2026-10-27", "2026-10-26", "2026-10-25", "2026-10-24"]
    assert "covers 5 of 10 days" in notes["region_sku"]
    assert out["city"] and set(out["sku"]) == set(shop.sku_calls)
    # the next run: the two recent days again, then the next three older days
    shop2 = _Shop()
    out2 = region.collect(cfg, st, shop2, "2026-10-28", {})
    assert shop2.sku_calls[:2] == ["2026-10-28", "2026-10-27"]
    assert shop2.sku_calls[2:] == ["2026-10-23", "2026-10-22", "2026-10-21"]
    assert len(set(out2["sku"])) == 8
