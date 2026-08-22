"""Résilience du client HTTP : timeouts, rejeux bornés, 4xx non rejouées."""

import io
import json
import os
import tempfile
import unittest
import urllib.error

from api_client import (
    BACKOFF_BASE_SECONDS,
    BACKOFF_MAX_SECONDS,
    MAX_ATTEMPTS,
    ApiClient,
    ApiError,
    _backoff_delay,
)

TOKEN = "worker-secret-token"
MEDIA_TOKEN = "media.token.value"


class FakeResponse:
    def __init__(self, status=200, body=b""):
        self.status = status
        self._body = io.BytesIO(body)

    def read(self, size=-1):
        return self._body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FakeOpener:
    """Rejoue les issues fournies dans l'ordre, puis répète la dernière."""

    def __init__(self, *outcomes):
        self._outcomes = list(outcomes) or [FakeResponse(204)]
        self.calls = []

    def __call__(self, request, timeout=None):
        self.calls.append({"request": request, "timeout": timeout})
        outcome = self._outcomes[min(len(self.calls), len(self._outcomes)) - 1]
        if isinstance(outcome, BaseException):
            raise outcome
        return FakeResponse(outcome.status, outcome.read())


def json_response(payload, status=200):
    return FakeResponse(status, json.dumps(payload).encode("utf-8"))


def http_error(status):
    return urllib.error.HTTPError("http://api.test/api/worker/jobs/claim", status, "boom", {}, None)


def network_error():
    return urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))


class ClientFixture(unittest.TestCase):
    def build(self, *outcomes):
        self.opener = FakeOpener(*outcomes)
        self.sleeps = []
        return ApiClient(
            "http://api.test/",
            TOKEN,
            opener=self.opener,
            sleeper=self.sleeps.append,
        )

    def last_body(self):
        return json.loads(self.opener.calls[-1]["request"].data.decode("utf-8"))


class RequestShapeTest(ClientFixture):
    def test_claim_posts_the_worker_identity_and_served_models(self):
        client = self.build(json_response({"transcriptionId": "t-1", "runId": "r-1"}))

        job = client.claim("worker-7", ("tiny", "large"))

        request = self.opener.calls[0]["request"]
        self.assertEqual("POST", request.get_method())
        self.assertEqual("http://api.test/api/worker/jobs/claim", request.full_url)
        self.assertEqual({"workerId": "worker-7", "models": ["tiny", "large"]}, self.last_body())
        self.assertEqual("t-1", job["transcriptionId"])

    def test_claim_returns_none_when_the_queue_is_empty(self):
        client = self.build(FakeResponse(204))

        self.assertIsNone(client.claim("worker-7", ("tiny",)))

    def test_a_malformed_body_is_reported_and_never_replayed(self):
        client = self.build(FakeResponse(200, b"<html>gateway is confused</html>"))

        with self.assertRaises(ApiError) as raised:
            client.claim("worker-7", ("tiny",))

        self.assertEqual(1, len(self.opener.calls))
        self.assertNotIn("gateway", str(raised.exception))

    def test_post_segments_carries_the_batch_sequence(self):
        client = self.build(FakeResponse(204))
        batch = [{"startMs": 0, "endMs": 900, "text": "Bonjour."}]

        client.post_segments("run-1", "t-1", 4, batch)

        request = self.opener.calls[0]["request"]
        self.assertEqual("http://api.test/api/worker/jobs/run-1/segments", request.full_url)
        self.assertEqual(
            {"transcriptionId": "t-1", "batchSequence": 4, "segments": batch}, self.last_body()
        )

    def test_post_speakers_carries_the_turns(self):
        client = self.build(FakeResponse(204))
        turns = [{"startMs": 0, "endMs": 900, "speaker": 0}]

        client.post_speakers("run-1", "t-1", turns)

        request = self.opener.calls[0]["request"]
        self.assertEqual("POST", request.get_method())
        self.assertEqual("http://api.test/api/worker/jobs/run-1/speakers", request.full_url)
        self.assertEqual({"transcriptionId": "t-1", "turns": turns}, self.last_body())

    def test_fail_carries_the_reason(self):
        client = self.build(FakeResponse(204))

        client.fail("run-1", "t-1", "whisper exited with code 3")

        self.assertEqual("http://api.test/api/worker/jobs/run-1/fail", self.opener.calls[0]["request"].full_url)
        self.assertEqual("whisper exited with code 3", self.last_body()["reason"])

    def test_every_call_carries_an_explicit_timeout_and_the_bearer_token(self):
        client = self.build(json_response({"leaseExpiresAt": "2026-01-01T00:00:00.000Z"}))
        with tempfile.TemporaryDirectory() as workdir:
            destination = os.path.join(workdir, "media")
            client.claim("worker-7", ("tiny",))
            client.download_media(MEDIA_TOKEN, destination)
            client.post_segments("run-1", "t-1", 1, [])
            client.heartbeat("run-1", "t-1")
            client.complete("run-1", "t-1")
            client.fail("run-1", "t-1", "nope")

        self.assertEqual(6, len(self.opener.calls))
        for call in self.opener.calls:
            self.assertIsInstance(call["timeout"], float)
            self.assertGreater(call["timeout"], 0)
            self.assertEqual("Bearer " + TOKEN, call["request"].get_header("Authorization"))
            self.assertNotIn(TOKEN, call["request"].full_url)


class RetryTest(ClientFixture):
    def test_a_business_error_is_never_replayed(self):
        for status in (400, 403, 404, 409, 422):
            client = self.build(http_error(status))

            with self.assertRaises(ApiError) as raised:
                client.complete("run-1", "t-1")

            self.assertEqual(status, raised.exception.status)
            self.assertFalse(raised.exception.retryable)
            self.assertEqual(1, len(self.opener.calls))
            self.assertEqual([], self.sleeps)

    def test_a_server_error_is_replayed_a_bounded_number_of_times(self):
        client = self.build(http_error(503))

        with self.assertRaises(ApiError) as raised:
            client.heartbeat("run-1", "t-1")

        self.assertTrue(raised.exception.retryable)
        self.assertEqual(MAX_ATTEMPTS, len(self.opener.calls))
        self.assertEqual(MAX_ATTEMPTS - 1, len(self.sleeps))

    def test_a_rate_limit_is_replayed_until_it_succeeds(self):
        client = self.build(http_error(429), json_response({"transcriptionId": "t-1"}))

        job = client.claim("worker-7", ("tiny",))

        self.assertEqual("t-1", job["transcriptionId"])
        self.assertEqual(2, len(self.opener.calls))

    def test_a_network_error_is_replayed_until_it_succeeds(self):
        client = self.build(network_error(), TimeoutError("timed out"), FakeResponse(204))

        client.complete("run-1", "t-1")

        self.assertEqual(3, len(self.opener.calls))

    def test_a_network_error_gives_up_after_the_last_attempt(self):
        client = self.build(network_error())

        with self.assertRaises(ApiError) as raised:
            client.claim("worker-7", ("tiny",))

        self.assertTrue(raised.exception.retryable)
        self.assertIsNone(raised.exception.status)
        self.assertEqual(MAX_ATTEMPTS, len(self.opener.calls))

    def test_the_backoff_stays_within_its_exponential_ceiling(self):
        client = self.build(http_error(500))

        with self.assertRaises(ApiError):
            client.complete("run-1", "t-1")

        for attempt, delay in enumerate(self.sleeps, start=1):
            self.assertGreaterEqual(delay, 0.0)
            self.assertLessEqual(delay, BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)))

    def test_the_backoff_is_capped(self):
        self.assertLessEqual(max(_backoff_delay(20) for _ in range(200)), BACKOFF_MAX_SECONDS)
        self.assertGreater(max(_backoff_delay(3) for _ in range(200)), BACKOFF_BASE_SECONDS)


class MediaDownloadTest(ClientFixture):
    def test_streams_the_media_to_its_destination_after_a_transient_failure(self):
        client = self.build(network_error(), FakeResponse(200, b"opus-bytes"))

        with tempfile.TemporaryDirectory() as workdir:
            destination = os.path.join(workdir, "media")
            client.download_media(MEDIA_TOKEN, destination)

            with open(destination, "rb") as media:
                self.assertEqual(b"opus-bytes", media.read())
        self.assertEqual(2, len(self.opener.calls))
        self.assertTrue(self.opener.calls[0]["request"].full_url.endswith("/api/worker/media/media.token.value"))

    def test_no_error_message_leaks_a_token(self):
        client = self.build(network_error())

        with self.assertRaises(ApiError) as raised:
            client.download_media(MEDIA_TOKEN, os.devnull)

        message = str(raised.exception)
        self.assertNotIn(MEDIA_TOKEN, message)
        self.assertNotIn(TOKEN, message)
        self.assertIn("media download", message)


if __name__ == "__main__":
    unittest.main()
