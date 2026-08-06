import os
from collections.abc import Generator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session, sessionmaker

from models import Base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./history.db")

# timeout: don't fail immediately if another request currently holds the write lock —
# wait up to 5 seconds for it to release before retrying (SQLite's busy_timeout).
engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 5}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Apply Alembic migrations on startup.

    A fresh DB (no alembic_version table) is bootstrapped with create_all + stamp;
    an existing DB just gets upgrade head applied (same pattern as spira-base).
    """
    alembic_cfg = Config(str(Path(__file__).parent / "alembic.ini"))

    with engine.connect() as conn:
        has_alembic = inspect(conn).has_table("alembic_version")

    if not has_alembic:
        Base.metadata.create_all(bind=engine)
        command.stamp(alembic_cfg, "head")
    else:
        command.upgrade(alembic_cfg, "head")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
