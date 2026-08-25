"""🎧 THE EARS — a presigned WebSocket straight from the browser to Transcribe.

    "tried voice model..still its not listenig the voice...also getting some
     error"

The panel was showing the right message — "This browser blocks the speech
service (Brave and some privacy browsers do)" — and that message is useless to
the person reading it, because Brave is the browser he uses. Naming an obstacle
honestly is not the same as removing it, and I had treated it as though it were.

The Web Speech API is a Chrome feature that ships audio to Google, and Brave
strips it. No flag on our side changes that, so the ears move onto our stack.

WHY A PRESIGNED URL RATHER THAN A PROXY
---------------------------------------
The browser opens the socket to AWS ITSELF, using a URL we sign. So:

  * not one byte of audio passes through our box - an always-on microphone
    would otherwise mean a permanent audio stream per user, through a t3.micro
  * there is no long-lived connection for us to hold open, and nothing to
    reconnect when the app redeploys
  * the credential never leaves the server; what the browser gets is a
    signature that expires in five minutes and only permits transcription

Signing is done by hand rather than with botocore's SigV4 helpers because this
is a query-string signature on a WebSocket URL with no body - the one shape
those helpers make awkward, and the algorithm is thirty lines.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import logging
import urllib.parse

import boto3

log = logging.getLogger("mise.listen")

REGION = "eu-west-2"
HOST = f"transcribestreaming.{REGION}.amazonaws.com:8443"
PATH = "/stream-transcription-websocket"
SERVICE = "transcribe"
#: Transcribe wants a sample rate it was told about up front, and 16k is the
#: rate its models are trained on. Sending 44.1k costs bandwidth for nothing.
SAMPLE_RATE = 16000
#: Five minutes is plenty to OPEN the socket; the stream itself may then run
#: for as long as he keeps talking. A short window limits what a leaked URL is
#: worth without limiting the conversation.
EXPIRES = 300


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date: str) -> bytes:
    k = _sign(f"AWS4{secret}".encode(), date)
    k = _sign(k, REGION)
    k = _sign(k, SERVICE)
    return _sign(k, "aws4_request")


def presigned_url(language: str = "en-GB") -> str:
    """A WebSocket URL the browser may open, good for five minutes.

    Credentials come from the instance role, exactly like Polly and Bedrock, so
    there is no key to store and nothing to rotate.
    """
    creds = boto3.Session().get_credentials()
    if creds is None:
        raise RuntimeError("no AWS credentials available to sign with")
    creds = creds.get_frozen_credentials()

    now = dt.datetime.now(dt.UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    scope = f"{date_stamp}/{REGION}/{SERVICE}/aws4_request"

    params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{creds.access_key}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(EXPIRES),
        "X-Amz-SignedHeaders": "host",
        "language-code": language,
        "media-encoding": "pcm",
        "sample-rate": str(SAMPLE_RATE),
    }
    # An instance role hands out temporary credentials, which carry a session
    # token that has to be signed along with everything else.
    if creds.token:
        params["X-Amz-Security-Token"] = creds.token

    canonical_qs = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
        for k, v in sorted(params.items())
    )
    canonical_request = "\n".join(
        [
            "GET",
            PATH,
            canonical_qs,
            f"host:{HOST}\n",
            "host",
            hashlib.sha256(b"").hexdigest(),  # no body on a WebSocket upgrade
        ]
    )
    to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(creds.secret_key, date_stamp), to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"wss://{HOST}{PATH}?{canonical_qs}&X-Amz-Signature={signature}"
