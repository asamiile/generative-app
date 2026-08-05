import os

from fastapi import Header, HTTPException, status


def verify_token(authorization: str | None = Header(None)) -> None:
    expected = os.environ.get("APP_API_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="APP_API_TOKEN is not configured on the server",
        )

    # authorizationをHeader(...)(必須)にすると、ヘッダー自体が無いリクエストは
    # このコードに届く前にFastAPIが422を返してしまい、他の失敗と一貫しない。
    # Header(None)にして、無い場合もここで401として扱う。
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing token",
        )
