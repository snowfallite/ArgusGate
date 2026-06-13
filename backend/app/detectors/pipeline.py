from .base import BaseDetector
from .context import DetectionResult, RequestContext


class DetectionPipeline:
    def __init__(self, detectors: list[BaseDetector]):
        self._detectors = sorted(detectors, key=lambda d: d.layer)

    def get_layer(self, layer_num: int) -> BaseDetector | None:
        return next((d for d in self._detectors if d.layer == layer_num), None)

    async def run_input(self, ctx: RequestContext) -> RequestContext:
        """
        Полный input pipeline для последнего user-сообщения (default).
        L6 пропускается (output-only).
        """
        return await self.run_input_for_role(ctx, role="user")

    async def run_input_for_role(
        self, ctx: RequestContext, *, role: str
    ) -> RequestContext:
        """
        Прогон input-слоёв с учётом роли сообщения (§4.6-bis ТЗ).
        L6 не выполняется никогда (он стрим-only).
        L5 (session/Crescendo) — только для user-сообщений, иначе assistant/tool
            подделанная история ломала бы Crescendo по чужим эмбеддингам.
        """
        skip = {6}
        if role != "user":
            skip.add(5)
        for detector in self._detectors:
            if detector.layer in skip:
                continue
            result = await detector.safe_detect(ctx)
            if result:
                ctx.layer_results[detector.layer] = result
                if result.verdict == "block":
                    break
        return ctx

    async def run_output_layer(
        self, ctx: RequestContext, token: str, accumulated: str
    ) -> DetectionResult | None:
        layer6 = self.get_layer(6)
        if layer6 and layer6.enabled:
            from .layer6_output import OutputStreamLayer
            if isinstance(layer6, OutputStreamLayer):
                return await layer6.safe_detect_chunk(ctx, token, accumulated)
        return None

    async def reload_layer(self, layer_num: int) -> None:
        detector = self.get_layer(layer_num)
        if detector and hasattr(detector, "reload"):
            await detector.reload()
