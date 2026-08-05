import os

from fastapi import Header, HTTPException, status


def verify_token(authorization: str = Header(...)) -> None:
    expected = os.environ.get("APP_API_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="APP_API_TOKEN is not configured on the server",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing token",
        )
