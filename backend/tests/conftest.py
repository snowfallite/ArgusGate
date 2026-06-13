import pytest
from unittest.mock import AsyncMock, MagicMock

from app.detectors.context import RequestContext


@pytest.fixture
def ctx():
    return RequestContext(original_text="test input")


@pytest.fixture
def ctx_with_session():
    return RequestContext(original_text="test input", session_id="test-session-id")


@pytest.fixture
def mock_redis():
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.register_script = MagicMock(return_value=AsyncMock())
    return redis


@pytest.fixture
def mock_qdrant():
    qdrant = AsyncMock()
    qdrant.search = AsyncMock(return_value=[])
    return qdrant


@pytest.fixture
def mock_settings():
    settings = MagicMock()
    settings.vector_similarity_threshold = 0.92
    settings.ml_threshold_pass = 0.4
    settings.ml_threshold_block = 0.85
    settings.session_risk_threshold = 0.75
    settings.session_ttl_seconds = 1800
    settings.qdrant_collection = "attack_signatures"
    settings.layer7_enabled = True
    settings.signatures_dir = "/tmp/signatures"
    settings.models_dir = "/tmp/models"
    settings.judge_model = "gpt-4o-mini"
    settings.judge_provider = "openai"
    settings.judge_api_key = MagicMock()
    settings.judge_api_key.get_secret_value = MagicMock(return_value="test-key")
    return settings
