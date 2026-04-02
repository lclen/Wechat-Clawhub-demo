from __future__ import annotations

import ipaddress
import socket


DEFAULT_GATEWAY_HOST = "0.0.0.0"
DEFAULT_GATEWAY_PORT = 8300
LOOPBACK_HOST = "127.0.0.1"
PROBE_TARGETS: tuple[str, ...] = ("8.8.8.8", "1.1.1.1")


def detect_lan_ip() -> str | None:
    candidates: list[str] = []
    try:
        host_name = socket.gethostname()
        for _, _, _, _, sockaddr in socket.getaddrinfo(host_name, None, family=socket.AF_INET):
            ip = sockaddr[0]
            if is_preferred_lan_ip(ip):
                return ip
            if is_usable_ipv4(ip):
                candidates.append(ip)
    except OSError:
        pass

    for probe in PROBE_TARGETS:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect((probe, 80))
                ip = sock.getsockname()[0]
                if is_usable_ipv4(ip):
                    return ip
        except OSError:
            continue

    return candidates[0] if candidates else None


def preferred_gateway_base_url(port: int = DEFAULT_GATEWAY_PORT) -> str:
    host = detect_lan_ip() or LOOPBACK_HOST
    return f"http://{host}:{port}"


def is_preferred_lan_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    return ip.is_private and not ip.is_loopback and not ip.is_link_local


def is_usable_ipv4(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    return not ip.is_loopback and not ip.is_multicast and not ip.is_unspecified
