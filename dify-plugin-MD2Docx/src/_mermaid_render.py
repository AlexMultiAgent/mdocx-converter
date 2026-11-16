"""Mermaid Ink API rendering — shared by `md2docx.py` and `mermaid_converter.py`.

Lives in its own file (no `Tool` subclass) so both tool modules can import it
without violating the Dify SDK's "exactly one Tool subclass per source file"
rule. Loaded by sibling tools via `importlib.util.spec_from_file_location`
because the SDK's class loader does not add the source file's directory to
`sys.path` for relative imports.
"""

import base64
import ipaddress
import json
import os
import socket
import time
import zlib
from urllib.parse import urlparse

import requests

# Public base URL of the Mermaid Ink service. Operators can override at runtime
# via the `MERMAID_INK_URL` env var (e.g. for self-hosted instances).
MERMAID_INK_URL = os.environ.get("MERMAID_INK_URL", "https://mermaid.ink")

PLUGIN_USER_AGENT = (
    "md2docx-dify-plugin/0.0.5 "
    "(+https://github.com/AlexMultiAgent/mdocx-converter)"
)

# Per-attempt timeout for a single Mermaid Ink HTTP request. Kept in sync with
# the value used in `md2docx.py` (the Dify tool entry point also has its own
# budget constants for retries/total time, but the per-request ceiling lives
# here because the standalone Mermaid tool reuses the same call).
MERMAID_REQUEST_TIMEOUT_SECONDS = 30

# Number of attempts per diagram (1 initial + N retries).
MERMAID_MAX_ATTEMPTS = 3

# Every rendered diagram must be a PNG; anything else (an HTML error page from
# a proxy, for instance) is rejected instead of being handed back as an image.
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Largest response we are willing to buffer from the rendering service.
MAX_RESPONSE_BYTES = 20 * 1024 * 1024

# Link-local addresses include the cloud instance metadata endpoint
# (169.254.169.254), which must never be reachable through a user-supplied URL.
_BLOCKED_HOSTNAMES = frozenset({
    "metadata.google.internal",
    "metadata.goog",
})

# The metadata endpoints of the common cloud providers. The Alibaba Cloud and
# the Oracle Cloud ones live outside the link-local range, so they need their
# own entries.
_BLOCKED_ADDRESSES = frozenset({
    ipaddress.ip_address("100.100.100.200"),   # Alibaba Cloud
    ipaddress.ip_address("192.0.0.192"),       # Oracle Cloud
    ipaddress.ip_address("169.254.169.254"),   # AWS / Azure / Google Cloud
    ipaddress.ip_address("fd00:ec2::254"),     # AWS, IPv6
})


def _blocked_reason(address) -> str | None:
    """Why the address must never be reached through a user URL, or None.

    The loopback and the unspecified address point at the host the plugin
    runs on, and the link-local range covers the metadata endpoint of the
    common cloud providers. A private address stays allowed: a self-hosted
    Mermaid Ink commonly lives on an internal network.
    """
    if isinstance(address, ipaddress.IPv6Address):
        mapped = address.ipv4_mapped
        if mapped is not None:
            address = mapped
        elif address != ipaddress.ip_address("::1") and address in ipaddress.ip_network("::/96"):
            # The IPv4-compatible form (::127.0.0.1) is not reported as a
            # mapped address, but it reaches the same host. ::1 is the IPv6
            # loopback and stays as it is.
            embedded = ipaddress.ip_address(int(address) & 0xFFFFFFFF)
            if embedded.version == 4:
                address = embedded
    if address.is_link_local:
        return "a link-local address"
    if address.is_loopback:
        return "the loopback address"
    if address.is_unspecified:
        return "the unspecified address"
    if address in _BLOCKED_ADDRESSES:
        return "a cloud metadata address"
    return None


class MermaidRenderError(Exception):
    """Raised when a diagram could not be rendered into a usable PNG."""


def _encode_mermaid_pako(diagram: str) -> str:
    """Encode a Mermaid diagram in pako format for the mermaid.ink GET API.

    Wraps the diagram in {"code":"..."} JSON, deflates with zlib (level 9),
    then base64url-encodes without padding. Matches the format produced by
    the Mermaid Live Editor's share URL.
    """
    payload = json.dumps({"code": diagram}, separators=(",", ":"))
    compressed = zlib.compress(payload.encode("utf-8"), level=9)
    return base64.urlsafe_b64encode(compressed).decode("ascii").rstrip("=")


def validate_api_url(api_url: str | None) -> str | None:
    """Validate a user-supplied Mermaid Ink base URL.

    Only http(s) is accepted, and the host the plugin runs on as well as the
    cloud metadata endpoints are refused. Private ranges stay allowed because
    a self-hosted instance commonly lives on an internal network.

    Returns the URL to use, or None when the default should be used.
    """
    if not api_url or not api_url.strip():
        return None

    candidate = api_url.strip()
    parsed = urlparse(candidate)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(
            f"mermaid_api_url must use http or https, got '{parsed.scheme or 'no'} scheme'."
        )
    if parsed.query:
        raise ValueError("mermaid_api_url must not contain a query string.")
    if parsed.fragment:
        raise ValueError("mermaid_api_url must not contain a fragment.")

    host = parsed.hostname
    if not host:
        raise ValueError("mermaid_api_url must include a host name.")

    if host.lower() in _BLOCKED_HOSTNAMES:
        raise ValueError(f"mermaid_api_url must not point at '{host}'.")

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        reason = _blocked_reason(address)
        if reason:
            raise ValueError(
                f"mermaid_api_url must not point at {host}: it is {reason}."
            )
    if address is None:
        try:
            addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        except OSError:
            addresses = []
        for info in addresses:
            try:
                resolved = ipaddress.ip_address(info[4][0])
            except ValueError:
                continue
            reason = _blocked_reason(resolved)
            if reason:
                raise ValueError(
                    f"mermaid_api_url host '{host}' resolves to {reason}."
                )

    return candidate


def describe_render_failure(error: Exception) -> str:
    """Describe a render failure without repeating what the service answered.

    The response of the service can hold internal data, so only the kind of
    failure reaches the caller — the status code and the body stay in the
    log, where the operator can read them.
    """
    if isinstance(error, requests.Timeout):
        return "the rendering service did not answer in time"
    if isinstance(error, requests.ConnectionError):
        return "the rendering service could not be reached"
    if isinstance(error, requests.HTTPError):
        return "the rendering service rejected the request"
    if isinstance(error, requests.RequestException):
        return "the request to the rendering service failed"
    if isinstance(error, (MermaidRenderError, ValueError)):
        return str(error)
    return f"the rendering failed ({type(error).__name__})"


def is_png(data: bytes) -> bool:
    """True when `data` starts with the PNG file signature."""
    return data[:len(PNG_SIGNATURE)] == PNG_SIGNATURE


def render_mermaid_via_api(
    diagram: str,
    api_url: str | None = None,
    timeout: float | None = None,
) -> bytes:
    """Render a Mermaid diagram via the Mermaid Ink API. Returns PNG bytes.

    Uses the GET /img/pako:<zlib+base64url> endpoint. If `api_url` is provided
    it overrides the default (supporting self-hosted instances).
    Raises `requests.RequestException` on HTTP / network errors.
    """
    base_url = api_url or MERMAID_INK_URL
    if api_url:
        # The name may have been re-pointed since the parameter was checked.
        validate_api_url(api_url)
    encoded = _encode_mermaid_pako(diagram)
    request_timeout = timeout or MERMAID_REQUEST_TIMEOUT_SECONDS
    request_deadline = time.monotonic() + request_timeout
    resp = requests.get(
        f"{base_url.rstrip('/')}/img/pako:{encoded}?type=png",
        headers={"User-Agent": PLUGIN_USER_AGENT},
        timeout=request_timeout,
        stream=True,
        allow_redirects=False,
    )
    try:
        resp.raise_for_status()
        chunks = []
        total = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if time.monotonic() > request_deadline:
                raise MermaidRenderError(
                    "Mermaid rendering exceeded its request deadline."
                )
            total += len(chunk)
            if total > MAX_RESPONSE_BYTES:
                raise MermaidRenderError(
                    f"Mermaid response exceeded {MAX_RESPONSE_BYTES} bytes."
                )
            chunks.append(chunk)
    finally:
        resp.close()
    return b"".join(chunks)


def _is_retryable(error: Exception) -> bool:
    """Return whether another attempt could reasonably succeed."""
    if isinstance(error, requests.HTTPError):
        status = error.response.status_code if error.response is not None else None
        return status in (408, 425, 429) or (
            status is not None and 500 <= status < 600
        )
    if isinstance(error, (requests.Timeout, requests.ConnectionError, OSError)):
        return True
    if isinstance(error, requests.RequestException):
        return False
    if isinstance(error, MermaidRenderError):
        return False
    if isinstance(error, ValueError):
        # A rejected URL will be rejected again.
        return False
    return True


def render_mermaid_with_retry(
    diagram: str,
    api_url: str | None = None,
    attempts: int = MERMAID_MAX_ATTEMPTS,
    timeout: float | None = None,
    deadline: float | None = None,
    renderer=None,
) -> bytes:
    """Render a diagram, retrying transient failures with exponential backoff.

    `deadline` is a `time.monotonic()` timestamp after which no further attempt
    is started and the per-request timeout is clamped to the time remaining.
    `renderer` lets a caller inject its own `render_mermaid_via_api` binding.
    Raises the last error if every attempt failed.
    """
    render = renderer or render_mermaid_via_api
    last_error: Exception | None = None
    max_attempts = max(1, attempts)
    for attempt in range(max_attempts):
        request_timeout = timeout
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise MermaidRenderError(
                    "Mermaid rendering ran out of time before the diagram could be rendered."
                )
            request_timeout = min(
                request_timeout or MERMAID_REQUEST_TIMEOUT_SECONDS, remaining
            )

        try:
            png_bytes = render(diagram, api_url=api_url, timeout=request_timeout)
            if not is_png(png_bytes):
                raise MermaidRenderError(
                    "The Mermaid service did not return a PNG image."
                )
            return png_bytes
        except Exception as e:
            last_error = e
            if not _is_retryable(e):
                raise
            if attempt < max_attempts - 1:
                # 1s, 2s, 4s, ...
                delay = 1 * (2 ** attempt)
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise MermaidRenderError(
                            "Mermaid rendering ran out of time between attempts."
                        ) from e
                    delay = min(delay, remaining)
                if delay > 0:
                    time.sleep(delay)

    raise last_error if last_error else MermaidRenderError("Mermaid rendering failed.")
