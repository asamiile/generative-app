import os
from collections.abc import Generator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session, sessionmaker

from models import Base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./history.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """起動時にAlembicマイグレーションを適用する。

    alembic_versionテーブルがない新規DBはcreate_all + stampでブートストラップし、
    既存DBはupgrade headで差分だけ適用する(spira-baseと同じパターン)。
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
