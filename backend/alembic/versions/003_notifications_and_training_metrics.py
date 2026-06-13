"""notifications + training_job_metrics + training_jobs.progress_percent

Revision ID: 003
Revises: 002
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── training_jobs.progress_percent ────────────────────────────────────
    op.add_column(
        "training_jobs",
        sa.Column("progress_percent", sa.Float(), nullable=False, server_default="0.0"),
    )

    # ── training_job_metrics ──────────────────────────────────────────────
    op.create_table(
        "training_job_metrics",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id",
            UUID(as_uuid=True),
            sa.ForeignKey("training_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("epoch", sa.Integer(), nullable=False),
        sa.Column("eval_loss", sa.Float(), nullable=True),
        sa.Column("precision", sa.Float(), nullable=True),
        sa.Column("recall", sa.Float(), nullable=True),
        sa.Column("f1", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("job_id", "epoch", name="uq_training_job_metrics_job_epoch"),
    )

    # ── notifications ─────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("payload", JSONB(), nullable=True),
        sa.Column("fingerprint", sa.String(64), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_notifications_unread", "notifications", ["read_at", "created_at"],
    )
    op.create_index(
        "idx_notifications_category_time", "notifications", ["category", "created_at"],
    )
    op.create_index(
        "idx_notifications_fingerprint",
        "notifications",
        ["fingerprint"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_notifications_fingerprint", table_name="notifications")
    op.drop_index("idx_notifications_category_time", table_name="notifications")
    op.drop_index("idx_notifications_unread", table_name="notifications")
    op.drop_table("notifications")
    op.drop_table("training_job_metrics")
    op.drop_column("training_jobs", "progress_percent")
