import os
import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.link_token_transactions import LinkTokenTransactions
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.investments_transactions_get_request import InvestmentsTransactionsGetRequest
from plaid.model.investments_transactions_get_request_options import InvestmentsTransactionsGetRequestOptions
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.webhook_verification_key_get_request import WebhookVerificationKeyGetRequest
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest

PLAID_CLIENT_ID = os.environ.get("PLAID_CLIENT_ID")
PLAID_SECRET = os.environ.get("PLAID_SECRET")
PLAID_ENV = os.environ.get("PLAID_ENV", "sandbox")

_env_map = {
    "sandbox": plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}

# None when Plaid isn't configured: bank linking answers 503, and the rest of
# the API (research, demo portfolio, billing) still runs.
client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(
    host=_env_map[PLAID_ENV],
    api_key={"clientId": PLAID_CLIENT_ID, "secret": PLAID_SECRET},
))) if PLAID_CLIENT_ID and PLAID_SECRET else None

# Plaid's investment transaction `type` is "buy"/"sell"/"cash"/"fee"/"transfer";
# the dividend signal lives in `subtype`, not `type` — a cash dividend payout
# is type="cash" subtype="dividend", but a DRIP purchase (dividend that
# auto-buys more shares) shows up as type="buy" subtype="dividend reinvestment".
# Matching on subtype alone catches both without hardcoding the type pairing.
DIVIDEND_SUBTYPES = {"dividend", "dividend reinvestment"}

# Plaid keeps roughly 24 months of transaction history available;
# days_requested asks Link to pull as much of it as the institution will
# give up during the initial connection, instead of the institution-
# dependent default, which is sometimes much shorter.
TRANSACTIONS_DAYS_REQUESTED = 730


def build_link_token_request(user_id: str) -> LinkTokenCreateRequest:
    """Link for a brokerage: Investments is the product the app needs, so institutions
    that only offer it (most brokerages) are listed; Transactions is requested where
    available. PLAID_WEBHOOK_URL is where Plaid sends sync and login-expiry events
    (https://<api>/api/plaid/webhook); without it Plaid sends none. PLAID_REDIRECT_URI
    is needed for institutions that sign in through their own site (OAuth) and must
    also be registered in the Plaid dashboard."""
    extra = {}
    if os.environ.get("PLAID_WEBHOOK_URL"):
        extra["webhook"] = os.environ["PLAID_WEBHOOK_URL"]
    if os.environ.get("PLAID_REDIRECT_URI"):
        extra["redirect_uri"] = os.environ["PLAID_REDIRECT_URI"]
    return LinkTokenCreateRequest(
        products=[Products("investments")],
        optional_products=[Products("transactions")],
        client_name="Mindful Money",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=user_id),
        transactions=LinkTokenTransactions(days_requested=TRANSACTIONS_DAYS_REQUESTED),
        **extra,
    )


def build_exchange_request(public_token: str) -> ItemPublicTokenExchangeRequest:
    return ItemPublicTokenExchangeRequest(public_token=public_token)


def build_sync_request(access_token: str, cursor: str) -> TransactionsSyncRequest:
    return TransactionsSyncRequest(access_token=access_token, cursor=cursor or "")


def build_accounts_request(access_token: str) -> AccountsGetRequest:
    """Covers checking, savings, credit cards, and loans in one call — Plaid
    returns `balances.limit` for credit accounts and leaves it null for
    every other type, which is what distinguishes a credit card row."""
    return AccountsGetRequest(access_token=access_token)


def build_investment_txn_request(access_token: str, start_date, end_date, count: int = 500, offset: int = 0):
    return InvestmentsTransactionsGetRequest(
        access_token=access_token,
        start_date=start_date,
        end_date=end_date,
        options=InvestmentsTransactionsGetRequestOptions(count=count, offset=offset),
    )


def build_webhook_key_request(key_id: str) -> WebhookVerificationKeyGetRequest:
    return WebhookVerificationKeyGetRequest(key_id=key_id)


def build_item_remove_request(access_token: str) -> ItemRemoveRequest:
    return ItemRemoveRequest(access_token=access_token)


# Plaid error codes meaning the link can't be used until the user reconnects
# (or has revoked access). Retrying them is pointless; the app shows "reconnect".
ITEM_NEEDS_USER = {"ITEM_LOGIN_REQUIRED": "login_required", "USER_PERMISSION_REVOKED": "revoked",
                   "ACCESS_NOT_GRANTED": "revoked", "ITEM_NOT_FOUND": "revoked"}


def plaid_error_code(exc: Exception) -> str | None:
    """The Plaid `error_code` carried by an ApiException body, if any."""
    import json

    try:
        return json.loads(exc.body).get("error_code")
    except Exception:
        return None


def revoke_item(access_token: str) -> bool:
    """Ask Plaid to invalidate an access token (/item/remove). True when the
    token is gone -- including when Plaid says the item no longer exists.
    False when Plaid couldn't be reached or refused, so callers don't discard
    a credential that is still live. Without Plaid configured there is
    nothing to revoke."""
    if client is None:
        return True
    try:
        client.item_remove(build_item_remove_request(access_token))
        return True
    except plaid.ApiException as exc:
        return plaid_error_code(exc) == "ITEM_NOT_FOUND"
    except Exception:
        return False


def build_holdings_request(access_token: str) -> InvestmentsHoldingsGetRequest:
    return InvestmentsHoldingsGetRequest(access_token=access_token)
