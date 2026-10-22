"""Stock research endpoints.

Free:  search, the analysis matrix, side-by-side comparison (limited count)
Pro:   FCF growth vs the S&P 500, ROIC analysis, dividend growth vs the S&P 500,
       capital allocation, CSV export -- each gated by entitlements.require_feature,
       which rejects a Free account before any Pro data is loaded.
"""
from __future__ import annotations

import csv
import io
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from analytics import stock
from auth import User, current_user
from entitlements import Entitlement, entitlement, require_feature
from providers.base import ProviderUnavailable, SymbolNotFound
from providers.registry import providers

router = APIRouter(prefix="/api/stocks", tags=["stocks"])
SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")


def _symbol(symbol: str) -> str:
    s = symbol.strip().upper()
    if not SYMBOL.match(s):
        raise HTTPException(status_code=400, detail="That isn't a valid ticker symbol.")
    return s


async def _load(symbol: str):
    p = providers()
    try:
        return await p.fundamentals_for(symbol).fundamentals(symbol)
    except SymbolNotFound as exc:
        raise HTTPException(status_code=404, detail=f"No fundamentals found for {symbol}.") from exc
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="The data provider couldn't be reached. Try again shortly.") from exc


def _envelope(payload: dict) -> dict:
    return {**payload, "data_mode": providers().mode}


@router.get("/search")
async def search(q: str = Query("", max_length=40), _: User = Depends(current_user)):
    p = providers()
    results = await p.demo.search(q)
    if p.mode == "live" and q.strip():
        try:
            results = await p.live.search(q) + results
        except ProviderUnavailable:
            pass
    return {"results": results[:20], "data_mode": p.mode}


@router.get("/compare")
async def compare(symbols: str = Query(..., max_length=200), ent: Entitlement = Depends(entitlement)):
    wanted = [_symbol(s) for s in symbols.split(",") if s.strip()]
    limit = ent.to_dict()["compare_limit"]
    if len(wanted) > limit:
        raise HTTPException(status_code=402, detail={"code": "pro_required", "feature": "compare",
                                                     "message": f"Free accounts compare up to {limit} stocks; Pro compares more."})
    return _envelope({"stocks": [stock.matrix(await _load(s)) for s in dict.fromkeys(wanted)]})


@router.get("/{symbol}/matrix")
async def matrix(symbol: str, _: User = Depends(current_user)):
    return _envelope(stock.matrix(await _load(_symbol(symbol))))


@router.get("/{symbol}/fcf")
async def fcf(symbol: str, years: int = Query(5, ge=3, le=10), _: Entitlement = Depends(require_feature("fcf_vs_benchmark"))):
    s = _symbol(symbol)
    c = await _load(s)
    return _envelope(stock.fcf_analysis(c, await providers().aggregates_for(s), years))


@router.get("/{symbol}/roic")
async def roic(symbol: str, _: Entitlement = Depends(require_feature("roic"))):
    s = _symbol(symbol)
    return _envelope(stock.roic_analysis(await _load(s), await providers().aggregates_for(s)))


@router.get("/{symbol}/dividend-growth")
async def dividend_growth(symbol: str, years: int = Query(5, ge=3, le=10),
                          _: Entitlement = Depends(require_feature("dividend_vs_benchmark"))):
    s = _symbol(symbol)
    return _envelope(stock.dividend_growth_analysis(await _load(s), await providers().aggregates_for(s), years))


@router.get("/{symbol}/capital-allocation")
async def capital_allocation(symbol: str, _: Entitlement = Depends(require_feature("capital_allocation"))):
    return _envelope(stock.capital_allocation_analysis(await _load(_symbol(symbol))))


@router.get("/{symbol}/export.csv")
async def export_csv(symbol: str, _: Entitlement = Depends(require_feature("export"))):
    m = stock.matrix(await _load(_symbol(symbol)))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["section", "metric", "value", "unit", "status", "period", "formula", "reason"])
    for section in m["sections"]:
        for r in section["rows"]:
            w.writerow([section["label"], r["label"], r["value"], r["unit"], r["status"], r["period"], r["formula"], r["reason"]])
    w.writerow([])
    w.writerow(["source", m["provenance"]["source"], "retrieved", m["provenance"]["retrieved_at"],
                "demo" if m["provenance"]["demo"] else ""])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{m["symbol"]}-analysis.csv"'})
