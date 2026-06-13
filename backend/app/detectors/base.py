from abc import ABC, abstractmethod

import structlog

from .context import DetectionResult, RequestContext

logger = structlog.get_logger()


class BaseDetector(ABC):
    layer: int
    enabled: bool = True

    @abstractmethod
    async def detect(self, ctx: RequestContext) -> DetectionResult: ...

    async def safe_detect(self, ctx: RequestContext) -> DetectionResult | None:
        if not self.enabled:
            return None
        try:
            return await self.detect(ctx)
        except Exception as exc:
            logger.error("detector_failed", layer=self.layer, error=str(exc))
            return None
