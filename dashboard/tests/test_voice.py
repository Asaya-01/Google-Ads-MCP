"""Ask Claude's mic: the Speech-to-Text request and its errors (no network)."""

import base64

import pytest

from app import ask, settings, voice


class Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class Session:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def post(self, url, json, timeout):
        self.calls.append(json)
        return self.responses.pop(0)


def pcm(seconds):
    return base64.b64encode(b"\0\0" * int(16000 * seconds)).decode()


VCFG = {"language": "en-IN", "model": "latest_long", "boost": 12, "max_seconds": 60}


def test_request_uses_indian_english_and_the_dashboard_vocabulary():
    s = Session(Resp(200, {"results": [{"alternatives": [{"transcript": "why is revenue down"}]}, {"alternatives": [{"transcript": "today"}]}]}))
    assert voice.transcribe(pcm(2), VCFG, session=s) == "why is revenue down today"
    cfg = s.calls[0]["config"]
    assert cfg["languageCode"] == "en-IN" and cfg["sampleRateHertz"] == 16000 and cfg["model"] == "latest_long"
    words = cfg["speechContexts"][0]["phrases"]
    assert {"ROAS", "PMax", "GoKwik", "UAS", "Even Tone Underarm Mist"} <= set(words)
    assert len(words) == len({w.lower() for w in words})


def test_a_model_the_language_lacks_falls_back_to_the_default():
    s = Session(Resp(400, {"error": {"message": "model not supported"}}), Resp(200, {"results": []}))
    assert voice.transcribe(pcm(1), VCFG, session=s) == ""
    assert "model" not in s.calls[1]["config"]


def test_errors_say_what_to_do():
    with pytest.raises(voice.VoiceError) as e:
        voice.transcribe(pcm(1), VCFG, session=Session(Resp(403, {"error": {"message": "API not enabled"}})))
    assert e.value.status == 503 and "not enabled" in e.value.text
    with pytest.raises(voice.VoiceError) as e:
        voice.transcribe(pcm(0.1), VCFG, session=Session())
    assert e.value.status == 400
    with pytest.raises(voice.VoiceError) as e:
        voice.transcribe(pcm(75), VCFG, session=Session())
    assert e.value.status == 413
    with pytest.raises(voice.VoiceError):
        voice.transcribe("not base64!!", VCFG, session=Session())


def test_voice_questions_are_flagged_to_the_model():
    from types import SimpleNamespace as NS

    class Client:
        def __init__(self):
            self.kw = None
            self.beta = NS(messages=NS(stream=self.stream))

        def stream(self, **kw):
            self.kw = kw
            raise RuntimeError("stop here")

    c = Client()
    with pytest.raises(RuntimeError):
        list(ask.answer("why is revise down", [], None, ask.config(), None, client=c, voice=True))
    assert "speech-to-text" in c.kw["messages"][-1]["content"]
    c2 = Client()
    with pytest.raises(RuntimeError):
        list(ask.answer("why is revenue down", [], None, ask.config(), None, client=c2))
    assert "speech-to-text" not in c2.kw["messages"][-1]["content"]


def test_voice_is_configured():
    v = ask.config()["voice"]
    assert v["enabled"] and v["language"] == "en-IN"
    assert settings.config()["assistant"]["voice"]["max_seconds"] <= 60
