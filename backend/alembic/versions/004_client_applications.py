"""client_applications table

Revision ID: 004
Revises: 003
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_applications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("gateway_key_encrypted", sa.LargeBinary(), nullable=False),
        sa.Column("gateway_key_fingerprint", sa.String(64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("gateway_key_fingerprint", name="uq_client_app_fingerprint"),
    )
    op.create_index("idx_client_app_fingerprint", "client_applications", ["gateway_key_fingerprint"])
    op.create_index("idx_client_app_is_active", "client_applications", ["is_active"])


def downgrade() -> None:
    op.drop_index("idx_client_app_is_active", table_name="client_applications")
    op.drop_index("idx_client_app_fingerprint", table_name="client_applications")
    op.drop_table("client_applications")
