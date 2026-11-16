"""
Tests for the Mermaid Ink URL validation.

The URL arrives as a tool parameter, so it can carry whatever the document
under conversion asks for. It must not be able to reach the host the plugin
runs on or the cloud instance metadata endpoints.
"""
import ipaddress
import os
import socket
import sys

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from _mermaid_render import describe_render_failure, validate_api_url  # noqa: E402


class TestBlockedTargets:
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1:5002/",
            "http://127.0.0.53/",
            "http://localhost/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://0.0.0.0/",
            "http://[::]/",
            "http://169.254.169.254/latest/meta-data/",
            "http://100.100.100.200/latest/meta-data/",
            "http://metadata.google.internal/",
            "http://metadata.goog/",
        ],
    )
    def test_refuses_the_host_and_the_metadata_endpoints(self, url):
        with pytest.raises(ValueError):
            validate_api_url(url)

    def test_refuses_a_name_that_resolves_to_the_host(self, monkeypatch):
        def fake_getaddrinfo(host, port, *args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]

        monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

        with pytest.raises(ValueError):
            validate_api_url("http://mermaid.internal/")

    def test_refuses_a_name_that_resolves_to_the_metadata_endpoint(self, monkeypatch):
        def fake_getaddrinfo(host, port, *args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("100.100.100.200", 0))]

        monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

        with pytest.raises(ValueError):
            validate_api_url("http://metadata.internal/")


class TestAllowedTargets:
    def test_allows_a_self_hosted_instance_on_a_private_network(self):
        # A self-hosted Mermaid Ink commonly lives on an internal network.
        assert validate_api_url("http://10.0.0.5:8080/") == "http://10.0.0.5:8080/"

    def test_allows_the_public_service(self):
        assert validate_api_url("https://mermaid.ink") == "https://mermaid.ink"

    def test_allows_a_private_name_that_resolves_to_a_private_address(self, monkeypatch):
        def fake_getaddrinfo(host, port, *args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", 0))]

        monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

        assert validate_api_url("http://mermaid.internal/") == "http://mermaid.internal/"

    def test_keeps_its_structural_checks(self):
        with pytest.raises(ValueError):
            validate_api_url("ftp://mermaid.ink")
        with pytest.raises(ValueError):
            validate_api_url("https://mermaid.ink/?a=1")
        with pytest.raises(ValueError):
            validate_api_url("https://mermaid.ink/#fragment")


class TestFailureDescription:
    def test_does_not_repeat_the_service_response(self):
        error = requests.HTTPError(
            "404 Client Error: Not Found for url: http://10.0.0.9:52307/secret"
        )
        error.response = requests.Response()
        error.response.status_code = 404

        message = describe_render_failure(error)

        assert "52307" not in message
        assert "404" not in message
        assert "Not Found" not in message

    def test_names_the_kind_of_failure(self):
        assert "not answer in time" in describe_render_failure(requests.Timeout())
        assert "could not be reached" in describe_render_failure(
            requests.ConnectionError()
        )
        assert "rejected" in describe_render_failure(requests.HTTPError("boom"))


def test_ipv4_mapped_loopback_is_recognised():
    """The IPv4 loopback in an IPv6 address is still the loopback."""
    assert ipaddress.ip_address("::ffff:127.0.0.1").ipv4_mapped is not None
