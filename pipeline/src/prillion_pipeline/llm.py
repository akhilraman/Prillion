"""The one seam between the pipeline and an LLM vendor.

Everything else depends on the `LLM` protocol, so tests use a fake and a vendor
change touches only this file.
"""

from typing import Protocol

from .candidate import GeneratedQuestion

Message = dict[str, str]
"""{"role": "system" | "user" | "assistant", "content": "..."}"""


class LLMError(Exception):
    """The model refused, returned nothing parseable, or the call failed."""


class LLM(Protocol):
    model: str

    def generate(self, messages: list[Message]) -> GeneratedQuestion:
        """Return a schema-valid question or raise LLMError."""
        ...


class OpenAILLM:
    """Structured output via the Responses API: the SDK validates against our Pydantic schema."""

    def __init__(self, model: str, api_key: str | None = None) -> None:
        # Imported here so the rest of the pipeline (and its tests) never needs a key or network.
        from openai import OpenAI

        self.model = model
        self._client = OpenAI(api_key=api_key)  # falls back to OPENAI_API_KEY

    def generate(self, messages: list[Message]) -> GeneratedQuestion:
        try:
            response = self._client.responses.parse(
                model=self.model,
                input=messages,  # type: ignore[arg-type]
                text_format=GeneratedQuestion,
                store=False,  # don't retain our prompts server-side
            )
        except Exception as exc:  # SDK raises many types; callers only need "it failed"
            raise LLMError(f"OpenAI call failed: {exc}") from exc
        if response.output_parsed is None:
            raise LLMError("model returned no parseable output (refusal or empty)")
        return response.output_parsed
