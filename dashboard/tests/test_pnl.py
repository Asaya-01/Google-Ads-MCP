"""Profitability tab: finance's files read untouched, the Website slice built
with recomputed subtotals, finance's numbers never changed, marketplaces never
on the page. Every figure here is made up; no network."""

import datetime as dt
import io
import json
import pathlib
import re

import pytest

from app.pnl import build, config, importer, line_key, month_key
from app.store import LocalStore

ROOT = pathlib.Path(__file__).resolve().parent.parent
NOW = dt.datetime(2026, 11, 20, 6, tzinfo=dt.timezone.utc)


def channel_table():
    """A Channel P&L tab in the investor pack's layout, ₹ lakh, made up."""
    head = ["Line item", "Apr-26", "May-26", "Apr–May"]
    web = [("GMV", 200, 220), ("Discounts / trade margin", 82, 92), ("Gross sales", 118, 128), ("Net revenue", 100, 108.47),
           ("COGS", 25, 27), ("Gross margin", 73, 79.47), ("DPC / payment gateway / marketplace fees", 1, 1), ("Packaging", 1, 1),
           ("Storage", 1, 1), ("Logistics (outward)", 10, 12), ("CM1", 60, 64.47), ("Visibility spends (ads)", 70, 80),
           ("Consumer promos", 0, 0), ("Samples", 5, 0), ("Total channel & performance spends", 75, 80), ("CM2", -15, -15.53),
           ("Influencer / awareness", 20, 22), ("Agency fees", 2, 2), ("Total brand building", 22, 24), ("CM3", -37, -39.53)]
    mkt = [("GMV", 500, 520), ("Net revenue", 300, 310), ("COGS", 80, 85), ("Gross margin", 220, 225), ("CM1", 150, 155)]
    rows = [["Channel P&L, ₹ lakh"], head, ["Website (Shopify)", None, None, None]]
    rows += [[l, a, b, (a or 0) + (b or 0)] for l, a, b in web]
    rows += [["Nykaa", None, None, None]] + [[l, a, b, a + b] for l, a, b in mkt]
    rows += [["Mystery line", 1, 1, 2], ["Checks"], ["anything after Checks", 9, 9, 18]]
    return rows


def xlsx(sheets: dict) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


MIS = {
    "Marketing Sheet": [[None, "Revenue: (Net of GST)", "Oct'26"]],
    "COGS Master": [["Particulars", "EAN", "COGS Per Unit"], ["Made-up Serum 30 ml", "890000000001", 60.5], ["Made-up Mist 100 ml", "890000000002", 70]],
    "Sales Dump": [["Markings", "Party Name", "Item Name", "Billed Quantity", "Sale Value", "Purchase Value", "COGS Value", "MRP", "MRP Sales", "Channel Tagging"],
                   ["B2C", "Shopify Sales", "Made-up Serum 30 ml", 100, 30000, 6050, 6050, 599, 59900, "Shopify"],
                   ["B2C", "Shopify Sales", "Made-up Mist 100 ml", 200, 50000, 14000, 14000, 449, 89800, "Shopify"],
                   ["KA B2B", "Nykaa", "Made-up Mist 100 ml", 500, 120000, 35000, 35000, 449, 224500, "Nykaa"]],
}

SHOP = {"2026-04": dict(orders=2000, gross_sales=1.5e7, discounts=-3e6, returns=-2e5, net_sales=1.18e7, taxes=1.9e6, shipping_charges=1e4, total_sales=1.37e7),
        "2026-05": dict(orders=2100, gross_sales=1.6e7, discounts=-3e6, returns=-2e5, net_sales=1.28e7, taxes=2e6, shipping_charges=1e4, total_sales=1.48e7)}


@pytest.fixture
def store(tmp_path):
    return LocalStore(str(tmp_path))


def load(store, data, name):
    for kind, payload in importer.read_upload(data, name):
        importer.save(store, kind, payload, name, "someone@example.com", now=NOW)
    return build.build(store, now=NOW, shopify=lambda months: SHOP)


def test_line_map_and_months():
    lines = config()["lines"]
    assert line_key("Logistics (outward)", lines) == "logistics"
    assert line_key("Influencer / awareness (combined in RPSG source)", lines) == "influencer"
    assert line_key("Total brand building", lines) == "brand" and line_key("Agency fees", lines) == "agency"
    assert line_key("Primary Freight & Damages", lines) == "freight"
    assert line_key("Something new", lines) is None
    assert month_key("Apr-26") == "2026-04" and month_key("Oct'26") == "2026-10" and month_key("April 2026") == "2026-04"
    assert month_key("Apr–Oct") is None and month_key(dt.datetime(2026, 6, 1)) == "2026-06"


def test_channel_pnl_is_read_untouched_for_every_channel():
    rows = importer.channel_pnl_rows(channel_table(), config())
    chans = {r["channel"] for r in rows}
    assert chans == {"Website (Shopify)", "Nykaa"}  # every channel kept; nothing after "Checks"
    web = {(r["month"], r["line_item"]): r["amount"] for r in rows if r["channel"] == "Website (Shopify)"}
    assert web[("2026-04", "Net revenue")] == 100 * 1e5 and web[("2026-05", "CM3")] == -39.53 * 1e5
    assert {r["month"] for r in rows} == {"2026-04", "2026-05"}  # the Apr–May total is not a month
    assert any(r["line_item"] == "Mystery line" and r["line_item_key"] is None for r in rows)


def test_website_slice_keeps_finance_numbers_and_derives_the_gm_gap(store):
    p = load(store, xlsx({"Channel P&L": channel_table()}), "Investor pack.xlsx")
    assert p["months"] == ["2026-04", "2026-05"] and p["channel"] == "Website (Shopify)"
    v = {l["key"]: l for l in p["lines"]}
    # finance's subtotals shown as stated
    assert v["cm3"]["values"] == [-37 * 1e5, -39.53 * 1e5] and v["cm3"]["status"] == ["closed", "closed"]
    # Gross margin 73 < Net revenue 100 − COGS 25 = 75: the 2 lakh gap is primary freight, derived
    assert v["freight"]["values"][0] == pytest.approx(2e5) and v["freight"]["status"][0] == "derived"
    assert v["gst"]["values"][0] == pytest.approx(18e5) and v["gst"]["status"][0] == "derived"
    assert [f["line"] for f in p["checks"]["arithmetic"] if f["month"] == "2026-04"] == ["gm"]
    # marketplaces are stored but never on the page
    blob = json.dumps(p)
    assert "Nykaa" not in blob and "Mystery line" not in blob
    stored = store.get_json(p["versions"][0]["path"])
    assert {r["channel"] for r in stored["rows"]} == {"Website (Shopify)", "Nykaa"}


def test_a_real_mismatch_is_flagged_not_fixed(store):
    t = channel_table()
    for r in t:
        if r and r[0] == "CM2":
            r[1] = -10  # stated CM2 does not follow from CM1 − spends (60 − 75 = −15)
            break
    p = load(store, xlsx({"Channel P&L": t}), "pack.xlsx")
    cm2 = next(l for l in p["lines"] if l["key"] == "cm2")
    assert cm2["values"][0] == -10 * 1e5  # finance's number, unchanged
    f = [x for x in p["checks"]["arithmetic"] if x["line"] == "cm2"]
    assert f and f[0]["recomputed"] == pytest.approx(-15 * 1e5)


def test_mis_gives_cogs_and_website_skus(store):
    load(store, xlsx({"Channel P&L": channel_table()}), "pack.xlsx")
    parts = importer.read_upload(xlsx(MIS), "WCPL_MIS_Oct-2026.xlsx")
    assert [k for k, _ in parts] == ["mis"]
    mis = parts[0][1]
    assert mis["month"] == "2026-10" and len(mis["cogs_master"]) == 2
    assert [r["item"] for r in mis["d2c_skus"]] == ["Made-up Mist 100 ml", "Made-up Serum 30 ml"]  # Shopify lines only
    assert mis["d2c_skus"][0] == {"item": "Made-up Mist 100 ml", "qty": 200, "net_revenue": 50000, "cogs": 14000, "mrp_sales": 89800}
    importer.save(store, "mis", mis, "WCPL_MIS_Oct-2026.xlsx", "someone@example.com", now=NOW + dt.timedelta(seconds=5))
    p = build.build(store, now=NOW, shopify=lambda months: SHOP)
    assert "2026-10" in p["skus"] and p["skus"]["2026-10"]["rows"][0]["gm_pct"] == pytest.approx(1 - 14000 / 50000)
    assert next(c for c in p["cost_inputs"] if c["key"] == "cogs_sku")["state"] == "provided"


def test_reconciliation_and_empty_cost_tables(store):
    p = load(store, xlsx({"Channel P&L": channel_table()}), "pack.xlsx")
    r = p["checks"]["recon"][0]
    assert r["month"] == "2026-04" and r["gap"] == pytest.approx(100e5 - 1.18e7)
    for t in ("cogs_sku", "logistics", "payment", "other_variable", "allocation_rules"):
        body = store.get_json(f"private/pnl/costs/{t}.json")
        assert body["rows"] == [] and body["columns"]  # Phase 2: empty, never filled with stand-ins


def test_reimport_is_a_new_version_and_never_overwrites(store):
    load(store, xlsx({"Channel P&L": channel_table()}), "pack v1.xlsx")
    t = channel_table()
    for r in t:
        if r and r[0] == "COGS":
            r[1] = 26
            break
    for kind, payload in importer.read_upload(xlsx({"Channel P&L": t}), "pack v2.xlsx"):
        importer.save(store, kind, payload, "pack v2.xlsx", "someone@example.com", now=NOW + dt.timedelta(minutes=1))
    p = build.build(store, now=NOW, shopify=lambda months: SHOP)
    assert len(p["versions"]) == 2 and p["versions"][0]["source_name"] == "pack v2.xlsx"
    assert next(l for l in p["lines"] if l["key"] == "cogs")["values"][0] == 26e5  # the newest import wins
    assert store.get_json(p["versions"][1]["path"])["rows"]  # the old one is still there


def test_json_extract_loads_too(store):
    pack = {"tables": {"channel_pnl": [{"channel": "Website", "month": "Apr-26", "gmv": 2.0, "disc": 0.82, "gross": 1.18, "net_rev": 1.0, "cogs": 0.25, "gm": 0.73,
                                        "fees": 0.01, "packaging": 0.01, "storage": 0.01, "logistics": 0.1, "cm1": 0.6, "ads": 0.7, "promos": 0, "samples": 0.05,
                                        "chan_spend": 0.75, "cm2": -0.15, "influencer": 0.2, "agency": 0.02, "brand": 0.22, "cm3": -0.37},
                                       {"channel": "Website", "month": "Apr–Oct", "net_rev": 9.9}]}}
    p = load(store, json.dumps(pack).encode(), "asaya_pack.json")
    assert p["months"] == ["2026-04"]
    assert next(l for l in p["lines"] if l["key"] == "net_rev")["values"] == [1e7]


def test_bad_files_are_refused_with_a_reason():
    with pytest.raises(importer.ImportError_, match="Channel P&L|COGS Master"):
        importer.read_upload(xlsx({"Random": [["a", 1]]}), "x.xlsx")
    with pytest.raises(importer.ImportError_):
        importer.read_upload(b"not a workbook", "x.xlsx")


def test_upload_endpoint_and_page(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    store = LocalStore(str(tmp_path))
    monkeypatch.setattr(main, "store", lambda: store)
    monkeypatch.setattr(build, "shopify_monthly", lambda months: SHOP)
    main.app.dependency_overrides[main.current_user] = lambda: "someone@example.com"
    try:
        c = TestClient(main.app)
        empty = c.get("/api/page/profitability").json()
        assert empty["months"] == []  # the upload button shows before the first import
        r = c.post("/api/pnl/upload", content=xlsx({"Channel P&L": channel_table()}), headers={"X-File-Name": "pack.xlsx"})
        assert r.status_code == 200, r.text
        assert r.json()["months"] == ["2026-04", "2026-05"]
        bad = c.post("/api/pnl/upload", content=b"nope", headers={"X-File-Name": "x.xlsx"})
        assert bad.status_code == 422
        page = c.get("/api/page/profitability").json()
        assert page["title"] == "Profitability" and "Nykaa" not in json.dumps(page)
    finally:
        main.app.dependency_overrides.clear()


def test_no_bigquery_and_no_figures_in_the_repository():
    code = "".join(f.read_text() for f in (ROOT / "app" / "pnl").glob("*.py"))
    assert not re.search(r"bq\.run|google\.cloud import bigquery|from \.\. import bq", code)
    cfg = json.dumps(config())
    assert not re.search(r"\d{5,}", cfg)  # structure only: no amounts in config
