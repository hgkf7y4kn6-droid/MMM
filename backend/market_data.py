"""Latest price for one ticker (GET /api/market/ticker/{symbol}), through the
configured price provider (providers.registry): Tiingo end-of-day in live
mode, the demo series otherwise."""
from providers.registry import providers


async def get_ticker_price(symbol: str) -> dict:
    symbol = symbol.strip().upper()
    p = providers()
    q = await p.prices_for(symbol).quote(symbol)
    return {"ticker": symbol, "price": q.price, "as_of": q.as_of,
            "source": "demo" if p.mode == "demo" or symbol.startswith("DEMO-") else "tiingo-eod",
            "delayed": True, "note": "End-of-day close, not a real-time quote."}
