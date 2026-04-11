import os
from typing import Iterator

from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy import inspect, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./database.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    _ensure_supplier_contact_columns()
    _ensure_user_columns()
    _ensure_purchase_columns()
    _ensure_llmtask_columns()


def _ensure_supplier_contact_columns() -> None:
    expected_columns = {
        "source": "VARCHAR",
        "confidence": "FLOAT",
        "dedup_key": "VARCHAR",
    }
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_columns = {column["name"] for column in inspector.get_columns("suppliercontact")}
        for column_name, column_type in expected_columns.items():
            if column_name in existing_columns:
                continue
            conn.execute(text(f"ALTER TABLE suppliercontact ADD COLUMN {column_name} {column_type}"))


def _ensure_user_columns() -> None:
    expected_columns = {
        "full_name": "VARCHAR",
        "organization": "VARCHAR",
        "is_admin": "BOOLEAN DEFAULT FALSE",
        "is_active": "BOOLEAN DEFAULT TRUE",
    }
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_columns = {column["name"] for column in inspector.get_columns("user")}
        for column_name, column_type in expected_columns.items():
            if column_name in existing_columns:
                continue
            conn.execute(text(f'ALTER TABLE "user" ADD COLUMN {column_name} {column_type}'))


def _ensure_purchase_columns() -> None:
    expected_columns = {
        "is_archived": "BOOLEAN DEFAULT FALSE",
    }
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_columns = {column["name"] for column in inspector.get_columns("purchase")}
        for column_name, column_type in expected_columns.items():
            if column_name in existing_columns:
                continue
            conn.execute(text(f"ALTER TABLE purchase ADD COLUMN {column_name} {column_type}"))


def _ensure_llmtask_columns() -> None:
    expected_columns = {
        "updated_at": "TIMESTAMP",
    }
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_columns = {column["name"] for column in inspector.get_columns("llmtask")}
        for column_name, column_type in expected_columns.items():
            if column_name in existing_columns:
                continue
            conn.execute(text(f"ALTER TABLE llmtask ADD COLUMN {column_name} {column_type}"))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
