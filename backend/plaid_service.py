import os
import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.link_token_create_request_transactions import LinkTokenCreateRequestTransactions
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.investments_transactions_get_request import InvestmentsTransactionsGetRequest
from plaid.model.investments_transactions_get_request_options import InvestmentsTransactionsGetRequestOptions
from plaid.model.products import Products
from plaid.model.country_code import CountryCode

# ── Transfer product ─────────────────────────────────────────────────────────
# NOTE ON CONFIDENCE: Plaid's Transfer product (real ACH/RTP money movement,
# not just read access) is approval-gated — Plaid has to enable it on your
# account before any of these calls succeed, sandbox included, and its
# request/response shape has changed across plaid-python releases more than
# the read-only endpoints above. The class names below (TransferAuthorizationCreateRequest,
# TransferCreateRequest, TransferCapabilitiesGetRequest, TransferMigrateAccountRequest,
# TransferUserInRequest) match Plaid's current public docs, but verify them
# against your installed `plaid-python` version before relying on this in
# anything beyond sandbox — a version mismatch here fails loudly at import
# time, not silently, so it's a fast thing to catch.
from plaid.model.transfer_authorization_create_request import TransferAuthorizationCreateRequest
from plaid.model.transfer_create_request import TransferCreateRequest
from plaid.model.transfer_capabilities_get_request import TransferCapabilitiesGetRequest
from plaid.model.transfer_migrate_account_request import TransferMigrateAccountRequest
from plaid.model.transfer_user_in_request import TransferUserInRequest

PLAID_CLIENT_ID = os.environ["PLAID_CLIENT_ID"]
PLAID_SECRET = os.environ["PLAID_SECRET"]
PLAID_ENV = os.environ.get("PLAID_ENV", "sandbox")

_env_map = {
    "sandbox": plaid.Environment.Sandbox,
    "development": plaid.Environment.Development,
    "production": plaid.Environment.Production,
}

client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(
    host=_env_map[PLAID_ENV],
    api_key={"clientId": PLAID_CLIENT_ID, "secret": PLAID_SECRET},
)))

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
    return LinkTokenCreateRequest(
        # "transfer" only needs to be here if you want Link itself to run
        # Transfer-specific account verification during onboarding; the
        # Transfer API calls below work off the same access_token regardless,
        # as long as Transfer is enabled for your Plaid account.
        products=[Products("transactions"), Products("investments")],
        client_name="My Financial App",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=user_id),
        transactions=LinkTokenCreateRequestTransactions(days_requested=TRANSACTIONS_DAYS_REQUESTED),
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


# ------------------------------------------------------------------
# Transfer — move money in ("credit" to the user) or out ("debit" from the
# user) of a linked account. The sequence Plaid requires is strict:
# authorization_create MUST happen first (it's Plaid's real-time risk/NSF
# check) and its authorization_id is a required input to transfer_create —
# you cannot skip straight to creating a transfer.
# ------------------------------------------------------------------

def build_transfer_authorization_request(
    access_token: str, account_id: str, transfer_type: str, amount: str,
    legal_name: str, network: str = "ach", ach_class: str = "web",
):
    """transfer_type: "credit" (moving money TO the user's account — a
    "transfer in") or "debit" (pulling money FROM it — a "transfer out").
    amount must be a string like "12.34", not a float — Plaid is strict
    about this to avoid floating-point cent errors on real money movement."""
    return TransferAuthorizationCreateRequest(
        access_token=access_token,
        account_id=account_id,
        type=transfer_type,
        network=network,
        amount=amount,
        ach_class=ach_class,
        user=TransferUserInRequest(legal_name=legal_name),
    )


def build_transfer_create_request(
    access_token: str, account_id: str, authorization_id: str, amount: str,
    description: str, transfer_type: str, network: str = "ach", ach_class: str = "web",
):
    """description is capped at 10 characters by Plaid/NACHA for ACH — pass
    something short ("Deposit", "Payment") rather than a full sentence."""
    return TransferCreateRequest(
        access_token=access_token,
        account_id=account_id,
        authorization_id=authorization_id,
        type=transfer_type,
        network=network,
        amount=amount,
        ach_class=ach_class,
        description=description[:10],
    )


def build_transfer_capabilities_request(account_id: str, transfer_type: str, network: str = "ach"):
    """Checks whether this specific linked account supports a given rail
    (e.g. same-day ACH, RTP) before you try to authorize against it."""
    return TransferCapabilitiesGetRequest(account_id=account_id, type=transfer_type, network=network)


def build_transfer_migrate_account_request(account_number: str, routing_number: str, account_type: str, legal_name: str):
    """For bringing pre-verified account/routing numbers over from another
    processor without re-running Plaid's own verification flow. Returns a
    new access_token + account_id — treat that access_token exactly like
    one from item_public_token_exchange (encrypt at rest, store as a
    PlaidItem row) since it's just as much a live credential."""
    return TransferMigrateAccountRequest(
        account_number=account_number,
        routing_number=routing_number,
        account_type=account_type,
        user=TransferUserInRequest(legal_name=legal_name),
    )
