from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass

from claw_node.config import NodeSettings


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

    for probe in ("8.8.8.8", "1.1.1.1"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect((probe, 80))
                ip = sock.getsockname()[0]
                if is_usable_ipv4(ip):
                    return ip
        except OSError:
            continue

    return candidates[0] if candidates else None


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
