"""Store optional raw evaluator rationales.

Revision ID: 0006_experiment_result_rationale
Revises: 0005_queue_item_was_edited
Create Date: 2026-08-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_experiment_result_rationale"
down_revision: str | None = "0005_queue_item_was_edited"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("experiment_results", sa.Column("rationale", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("experiment_results", "rationale")
