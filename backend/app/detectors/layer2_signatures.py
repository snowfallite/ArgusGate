import asyncio
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple

import ahocorasick
import structlog
import yaml
from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..models.signature import Signature
from .base import BaseDetector
from .context import DetectionResult, RequestContext

logger = structlog.get_logger()

_PII_ENTITIES = [
    "CREDIT_CARD", "EMAIL_ADDRESS", "PHONE_NUMBER", "IBAN_CODE",
    "IP_ADDRESS", "RU_SNILS",
]


class _SigRecord(NamedTuple):
    id: str
    name: str
    category: str
    severity: str


class SignatureLayer(BaseDetector):
    layer = 2

    def __init__(self, settings: Settings):
        self._settings = settings
        self._regex_rules: list[tuple[re.Pattern, _SigRecord]] = []
        self._automaton: ahocorasick.Automaton | None = None
        self._pii_engine: AnalyzerEngine | None = None

    @property
    def pii_engine(self) -> AnalyzerEngine | None:
        """Доступ к Presidio-движку для переиспользования в L6.finalize_response (§4.6.4)."""
        return self._pii_engine

    @staticmethod
    def _build_pii_engine() -> AnalyzerEngine:
        from presidio_analyzer import Pattern, PatternRecognizer
        provider = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
        })
        engine = AnalyzerEngine(nlp_engine=provider.create_engine())
        snils_recognizer = PatternRecognizer(
            supported_entity="RU_SNILS",
            patterns=[Pattern(
                name="snils",
                regex=r"\b\d{3}-\d{3}-\d{3}\s\d{2}\b",
                score=0.85,
            )],
        )
        engine.registry.add_recognizer(snils_recognizer)
        return engine

    async def warm_up(self) -> None:
        loop = asyncio.get_event_loop()
        self._pii_engine = await loop.run_in_executor(None, self._build_pii_engine)
        logger.info("pii_engine_loaded")

    async def seed_from_yaml(self, db: AsyncSession) -> None:
        signatures_dir = Path(self._settings.signatures_dir)
        if not signatures_dir.exists():
            logger.warning("signatures_dir_not_found", path=str(signatures_dir))
            await self._load_from_db(db)
            return

        for yaml_file in signatures_dir.glob("*.yaml"):
            try:
                data = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
                rows = [
                    {
                        "id": sig["id"],
                        "name": sig["name"],
                        "pattern": sig["pattern"],
                        "pattern_type": sig.get("pattern_type", "regex"),
                        "category": sig.get("category"),
                        "severity": sig.get("severity", "medium"),
                        "enabled": True,
                        "created_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                        "hit_count": 0,
                    }
                    for sig in data.get("signatures", [])
                ]
                if rows:
                    stmt = pg_insert(Signature).values(rows).on_conflict_do_nothing(index_elements=["id"])
                    await db.execute(stmt)
            except Exception as exc:
                logger.error("yaml_seed_error", file=str(yaml_file), error=str(exc))

        await db.commit()
        await self._load_from_db(db)

    async def reload(self, db: AsyncSession | None = None) -> None:
        if db is None:
            from ..db import async_session_factory
            async with async_session_factory() as session:
                await self._load_from_db(session)
        else:
            await self._load_from_db(db)

    async def _load_from_db(self, db: AsyncSession) -> None:
        result = await db.execute(select(Signature).where(Signature.enabled.is_(True)))
        sigs = result.scalars().all()

        regex_rules: list[tuple[re.Pattern, _SigRecord]] = []
        automaton = ahocorasick.Automaton()
        idx = 0

        for sig in sigs:
            rec = _SigRecord(
                id=sig.id,
                name=sig.name,
                category=sig.category or "",
                severity=sig.severity or "medium",
            )
            if sig.pattern_type == "keyword":
                automaton.add_word(sig.pattern.lower(), (idx, rec))
                idx += 1
            else:
                try:
                    compiled = re.compile(sig.pattern, re.IGNORECASE | re.DOTALL)
                    regex_rules.append((compiled, rec))
                except re.error as exc:
                    logger.error("invalid_regex", sig_id=sig.id, error=str(exc))

        if idx > 0:
            automaton.make_automaton()
            self._automaton = automaton
        else:
            self._automaton = None

        self._regex_rules = regex_rules
        logger.info("signatures_loaded", regex=len(regex_rules), keywords=idx)

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        start = time.perf_counter()
        text = ctx.analysis_text

        for pattern, rec in self._regex_rules:
            if pattern.search(text):
                if not ctx.metadata.get("test_mode"):
                    asyncio.create_task(self._increment_hit(rec.id))
                return DetectionResult(
                    layer=2, verdict="block", score=1.0,
                    category=rec.category, matched_rule=rec.id,
                    reason=f"regex:{rec.name}",
                    latency_ms=(time.perf_counter() - start) * 1000,
                )

        if self._automaton:
            for _, (_, rec) in self._automaton.iter(text.lower()):
                if not ctx.metadata.get("test_mode"):
                    asyncio.create_task(self._increment_hit(rec.id))
                return DetectionResult(
                    layer=2, verdict="block", score=1.0,
                    category=rec.category, matched_rule=rec.id,
                    reason=f"keyword:{rec.name}",
                    latency_ms=(time.perf_counter() - start) * 1000,
                )

        if self._pii_engine:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                lambda: self._pii_engine.analyze(text=text, language="en", entities=_PII_ENTITIES),
            )
            if results:
                entity = results[0].entity_type
                return DetectionResult(
                    layer=2, verdict="suspicious", score=results[0].score,
                    category="pii", matched_rule=f"presidio:{entity}",
                    reason=f"pii_detected:{entity}",
                    latency_ms=(time.perf_counter() - start) * 1000,
                )

        return DetectionResult(
            layer=2, verdict="pass", score=0.0, reason="no_match",
            latency_ms=(time.perf_counter() - start) * 1000,
        )

    async def _increment_hit(self, sig_id: str) -> None:
        try:
            from ..db import async_session_factory
            async with async_session_factory() as db:
                await db.execute(
                    update(Signature)
                    .where(Signature.id == sig_id)
                    .values(
                        hit_count=Signature.hit_count + 1,
                        last_triggered_at=datetime.now(timezone.utc),
                    )
                )
                await db.commit()
        except Exception:
            pass
