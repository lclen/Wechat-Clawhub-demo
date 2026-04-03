from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass

from claw_node.config import NodeSettings

_RFC1918_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)
_BENCHMARK_NETWORK = ipaddress.ip_network("198.18.0.0/15")


@dataclass(slots=True)
class NodeIdentity:
    hostname: str
    lan_ip: str | None
    advertised_address: str
    base_url: str
    platform: str
    capabilities: list[str]


def build_node_identity(settings: NodeSettings) -> NodeIdentity:
    hostname = settings.hostname.strip() or socket.gethostname()
    lan_ip = detect_lan_ip()
    advertised_host = settings.advertised_host.strip() or lan_ip or hostname or settings.node_id
    advertised_address = build_advertised_address(advertised_host, settings.advertised_port)
    return NodeIdentity(
        hostname=hostname,
        lan_ip=lan_ip,
        advertised_address=advertised_address,
        base_url=f"worker://{settings.node_id}",
        platform="windows",
        capabilities=["pull-task", "task-result", "task-failure"],
    )


def build_advertised_address(host: str, port: int) -> str:
    if not host:
        return ""
    if port <= 0:
        return host
    return f"{host}:{port}"


def detect_lan_ip() -> str | None:
    candidates: list[str] = []

    def collect(ip: str) -> None:
        if is_usable_ipv4(ip) and ip not in candidates:
            candidates.append(ip)

    try:
        host_name = socket.gethostname()
        for _, _, _, _, sockaddr in socket.getaddrinfo(host_name, None, family=socket.AF_INET):
            collect(sockaddr[0])
    except OSError:
        pass

    for probe in ("8.8.8.8", "1.1.1.1"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect((probe, 80))
                collect(sock.getsockname()[0])
        except OSError:
            continue

    if not candidates:
        return None

    candidates.sort(key=_ipv4_rank, reverse=True)
    return candidates[0]


def is_preferred_lan_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    return any(ip in network for network in _RFC1918_NETWORKS)


def is_usable_ipv4(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    return (
        not ip.is_loopback
        and not ip.is_multicast
        and not ip.is_unspecified
        and not ip.is_link_local
        and ip not in _BENCHMARK_NETWORK
    )


def _ipv4_rank(value: str) -> tuple[int, int, int, str]:
    ip = ipaddress.ip_address(value)
    assert isinstance(ip, ipaddress.IPv4Address)
    return (
        1 if is_preferred_lan_ip(value) else 0,
        1 if ip.is_private else 0,
        0 if ip in _BENCHMARK_NETWORK else 1,
        value,
    )
