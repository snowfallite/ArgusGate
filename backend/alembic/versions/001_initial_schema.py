"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "request_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_text", sa.Text, nullable=False),
        sa.Column("normalized_text", sa.Text),
        sa.Column("response_text", sa.Text),
        sa.Column("session_id", postgresql.UUID(as_uuid=True)),
        sa.Column("provider", sa.String(50)),
        sa.Column("model", sa.String(100)),
        sa.Column("input_tokens", sa.Integer),
        sa.Column("output_tokens", sa.Integer),
        sa.Column("final_verdict", sa.String(20)),
        sa.Column("total_latency_ms", sa.Float),
    )
    op.create_index("idx_request_logs_timestamp", "request_logs", ["timestamp"])
    op.create_index("idx_request_logs_session", "request_logs", ["session_id"])
    op.create_index("idx_request_logs_final_verdict", "request_logs", ["final_verdict"])

    op.create_table(
        "training_datasets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("sample_count", sa.Integer),
        sa.Column("train_count", sa.Integer),
        sa.Column("val_count", sa.Integer),
        sa.Column("test_count", sa.Integer),
        sa.Column("categories", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("source", sa.String(50)),
    )

    op.create_table(
        "training_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("status", sa.String(20)),
        sa.Column("method", sa.String(20)),
        sa.Column("base_model", sa.String(200)),
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("training_datasets.id", ondelete="SET NULL"),
        ),
        sa.Column("hyperparameters", postgresql.JSONB),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("duration_seconds", sa.Float),
        sa.Column("final_metrics", postgresql.JSONB),
        sa.Column("log_text", sa.Text),
        sa.Column("output_model_id", postgresql.UUID(as_uuid=True)),
        sa.Column("error_message", sa.Text),
    )

    op.create_table(
        "ml_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("type", sa.String(50)),
        sa.Column("base_model", sa.String(200)),
        sa.Column("target_layer", sa.Integer),
        sa.Column("file_path", sa.String(500)),
        sa.Column("size_mb", sa.Float),
        sa.Column("metrics", postgresql.JSONB),
        sa.Column("is_active", sa.Boolean, default=False),
        sa.Column(
            "training_job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("training_jobs.id", ondelete="SET NULL"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "detection_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_log_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("request_logs.id", ondelete="CASCADE"),
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("layer", sa.Integer, nullable=False),
        sa.Column("verdict", sa.String(20)),
        sa.Column("score", sa.Float),
        sa.Column("category", sa.String(50)),
        sa.Column("matched_rule", sa.String(100)),
        sa.Column("reason", sa.Text),
        sa.Column("latency_ms", sa.Float),
        sa.Column("label", sa.String(20)),
        sa.Column("label_category", sa.String(50)),
        sa.Column("labeled_at", sa.DateTime(timezone=True)),
        sa.Column("label_comment", sa.Text),
        sa.Column("in_training_dataset_id", postgresql.UUID(as_uuid=True)),
    )
    op.create_index("idx_detection_events_timestamp", "detection_events", ["timestamp"])
    op.create_index("idx_detection_events_layer", "detection_events", ["layer"])
    op.create_index("idx_detection_events_label", "detection_events", ["label"])
    op.create_index("idx_detection_events_verdict", "detection_events", ["verdict"])
    op.create_index("idx_detection_events_request_log", "detection_events", ["request_log_id"])

    op.create_table(
        "signatures",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("pattern", sa.Text, nullable=False),
        sa.Column("pattern_type", sa.String(20)),
        sa.Column("category", sa.String(50)),
        sa.Column("severity", sa.String(20)),
        sa.Column("enabled", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.Column("hit_count", sa.Integer, default=0),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_signatures_category", "signatures", ["category"])
    op.create_index("idx_signatures_enabled", "signatures", ["enabled"])

    op.create_table(
        "training_samples",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("training_datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("label", sa.String(20)),
        sa.Column("category", sa.String(50)),
        sa.Column("split", sa.String(10)),
        sa.Column("source_event_id", postgresql.UUID(as_uuid=True)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_training_samples_dataset", "training_samples", ["dataset_id"])
    op.create_index("idx_training_samples_split", "training_samples", ["split"])


def downgrade() -> None:
    op.drop_table("training_samples")
    op.drop_table("signatures")
    op.drop_table("detection_events")
    op.drop_table("ml_models")
    op.drop_table("training_jobs")
    op.drop_table("training_datasets")
    op.drop_table("request_logs")
