import os

from fastapi import Header, HTTPException, status


def verify_token(authorization: str | None = Header(None)) -> None:
    expected = os.environ.get("APP_API_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="APP_API_TOKEN is not configured on the server",
        )

    # Header(...) (required) would make FastAPI return 422 for a request with no
    # Authorization header at all, before this code ever runs — inconsistent with
    # every other failure mode here. Header(None) lets a missing header fall through
    # to the same 401 path as an invalid one.
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing token",
        )
