import pytest
from factories import make_question

from prillion_pipeline.llm import LLMError, OpenAILLM


def test_key_from_environment_is_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "  sk-test-key\n")

    assert OpenAILLM("some-model")._client.api_key == "sk-test-key"


def test_explicit_key_is_trimmed_too() -> None:
    assert OpenAILLM("some-model", api_key="sk-test-key \r\n")._client.api_key == "sk-test-key"


def test_failure_names_the_underlying_error_type_but_never_its_text(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = OpenAILLM("some-model", api_key="sk-test-key")

    def boom(**_: object) -> object:
        try:
            raise ValueError("Illegal header value b'Bearer sk-test-key\\n'")
        except ValueError as inner:
            raise RuntimeError("Connection error.") from inner

    monkeypatch.setattr(llm._client.responses, "parse", boom)

    with pytest.raises(LLMError) as caught:
        llm.generate([{"role": "user", "content": "hi"}])

    message = str(caught.value)
    assert "Connection error." in message and "ValueError" in message
    assert "sk-test-key" not in message and "Illegal header" not in message


def test_parsed_output_is_returned(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = OpenAILLM("some-model", api_key="sk-test-key")
    expected = make_question()

    class Response:
        output_parsed = expected

    monkeypatch.setattr(llm._client.responses, "parse", lambda **_: Response())

    assert llm.generate([{"role": "user", "content": "hi"}]) is expected
