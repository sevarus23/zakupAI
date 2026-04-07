"""CLI script to grant admin privileges to a user.

Usage:
    python -m scripts.make_admin user@example.com
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlmodel import Session, select, create_engine
from app.models import User

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://zakupai:zakupai@localhost:5432/zakupai",
)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.make_admin <email>")
        sys.exit(1)

    email = sys.argv[1]
    engine = create_engine(DATABASE_URL)

    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == email)).first()
        if not user:
            print(f"User {email} not found")
            sys.exit(1)

        user.is_admin = True
        session.add(user)
        session.commit()
        print(f"User {email} is now admin")


if __name__ == "__main__":
    main()
