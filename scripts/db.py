"""Lightweight database layer for training runs (SQLite via SQLAlchemy).

Stores training metadata (hyperparameters, metrics, checkpoints) in a local
file `models/training.db` — no database server required.
"""

import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# --- Database setup -----------------------------------------------------
BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "models" / "training.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class TrainingRun(Base):
    __tablename__ = "training_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at = Column(DateTime, nullable=True)
    device = Column(String(32), nullable=False)
    epochs = Column(Integer, nullable=False)
    batch_size = Column(Integer, nullable=False)
    learning_rate = Column(Float, nullable=False)
    vocab_size = Column(Integer, nullable=False)
    final_loss = Column(Float, nullable=True)
    checkpoint_path = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)


def init_db() -> None:
    """Create all tables."""
    Base.metadata.create_all(engine)


def log_run(
    device: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    vocab_size: int,
    final_loss: float | None = None,
    checkpoint_path: str | None = None,
    notes: str | None = None,
) -> int:
    """Insert a training run record and return its id."""
    init_db()
    with SessionLocal() as session:
        run = TrainingRun(
            device=device,
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            vocab_size=vocab_size,
            final_loss=final_loss,
            checkpoint_path=checkpoint_path,
            notes=notes,
        )
        session.add(run)
        session.commit()
        return run.id


def finish_run(run_id: int, final_loss: float | None = None, checkpoint_path: str | None = None) -> None:
    """Mark a training run as finished."""
    with SessionLocal() as session:
        run = session.get(TrainingRun, run_id)
        if run:
            run.finished_at = datetime.utcnow()
            if final_loss is not None:
                run.final_loss = final_loss
            if checkpoint_path is not None:
                run.checkpoint_path = checkpoint_path
            session.commit()
