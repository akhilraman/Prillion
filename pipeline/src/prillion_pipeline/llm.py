"""The one seam between the pipeline and an LLM vendor.

Everything else depends on the `LLM` protocol, so tests use a fake and a vendor
change touches only this file.
"""

import os
from typing import Protocol, TypeVar

from pydantic import BaseModel

from .candidate import GeneratedQuestion

T = TypeVar("T", bound=BaseModel)

Message = dict[str, str]
"""{"role": "system" | "user" | "assistant", "content": "..."}"""


class LLMError(Exception):
    """The model refused, returned nothing parseable, or the call failed."""


class LLM(Protocol):
    model: str

    def generate(self, messages: list[Message]) -> GeneratedQuestion:
        """Return a schema-valid grounded question or raise LLMError."""
        ...

    def parse(self, messages: list[Message], schema: type[T]) -> T:
        """Return an object of any schema we define (AI-knowledge samples, verdicts) or raise LLMError."""
        ...


class OpenAILLM:
    """Structured output via the Responses API: the SDK validates against our Pydantic schema."""

    def __init__(self, model: str, api_key: str | None = None) -> None:
        # Imported here so the rest of the pipeline (and its tests) never needs a key or network.
        from openai import OpenAI

        self.model = model
        # A secret pasted with a trailing newline/space makes the HTTP layer refuse the
        # Authorization header, which the SDK reports only as "Connection error." Trim it.
        key = (api_key or os.environ.get("OPENAI_API_KEY") or "").strip() or None
        self._client = OpenAI(api_key=key)

    def generate(self, messages: list[Message]) -> GeneratedQuestion:
        return self.parse(messages, GeneratedQuestion)

    def parse(self, messages: list[Message], schema: type[T]) -> T:
        try:
            response = self._client.responses.parse(
                model=self.model,
                input=messages,  # type: ignore[arg-type]
                text_format=schema,
                store=False,  # don't retain our prompts server-side
            )
        except Exception as exc:  # SDK raises many types; callers only need "it failed"
            # The SDK wraps network problems as a bare "Connection error."; the real reason is
            # one level down. Show only its TYPE, never its text: that text can echo request
            # headers, i.e. the API key.
            cause = exc.__cause__
            detail = f" (caused by {type(cause).__name__})" if cause is not None else ""
            raise LLMError(f"OpenAI call failed: {exc}{detail}") from exc
        if response.output_parsed is None:
            raise LLMError("model returned no parseable output (refusal or empty)")
        return response.output_parsed
