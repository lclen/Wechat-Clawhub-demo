from __future__ import annotations

import ipaddress
import re
import socket
import subprocess
from dataclasses import dataclass


DEFAULT_GATEWAY_HOST = "0.0.0.0"
DEFAULT_GATEWAY_PORT = 8300
LOOPBACK_HOST = "127.0.0.1"
PROBE_TARGETS: tuple[str, ...] = ("8.8.8.8", "1.1.1.1")
RFC1918_NETWORKS: tuple[ipaddress.IPv4Network, ...] = (
    ipaddress.IPv4Network("10.0.0.0/8"),
    ipaddress.IPv4Network("172.16.0.0/12"),
    ipaddress.IPv4Network("192.168.0.0/16"),
)


@dataclass(frozen=True, slots=True)
class IPv4InterfaceRecord:
    address: str
    prefix_length: int

    @property
    def network(self) -> ipaddress.IPv4Network:
        return ipaddress.IPv4Network(f"{self.address}/{self.prefix_length}", strict=False)

    @property
    def broadcast(self) -> str:
        return str(self.network.broadcast_address)


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
    return any(ip in network for network in RFC1918_NETWORKS)


def is_usable_ipv4(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    return not ip.is_loopback and not ip.is_multicast and not ip.is_unspecified


def directed_broadcast_targets() -> list[str]:
    targets: list[str] = []
    seen: set[str] = set()
    for interface in list_ipv4_interfaces():
        broadcast = interface.broadcast
        if broadcast in seen:
            continue
        seen.add(broadcast)
        targets.append(broadcast)
    return targets


def list_ipv4_interfaces() -> list[IPv4InterfaceRecord]:
    interfaces = _list_interfaces_from_ipconfig() or _list_interfaces_from_ip_addr()
    if interfaces:
        return interfaces

    detected = detect_lan_ip()
    if detected and is_preferred_lan_ip(detected):
        return [IPv4InterfaceRecord(address=detected, prefix_length=24)]
    return []


def _list_interfaces_from_ipconfig() -> list[IPv4InterfaceRecord]:
    try:
        completed = subprocess.run(
            ["ipconfig"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            check=False,
        )
    except OSError:
        return []
    if completed.returncode != 0 or not completed.stdout.strip():
        return []

    interfaces: list[IPv4InterfaceRecord] = []
    current_ip: str | None = None
    for raw_line in completed.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            current_ip = None
            continue
        ip_match = re.search(r"IPv4[^:：]*[:：]\s*(\d+\.\d+\.\d+\.\d+)", line, flags=re.IGNORECASE)
        if not ip_match:
            ip_match = re.search(r"IPv4 地址[^:：]*[:：]\s*(\d+\.\d+\.\d+\.\d+)", line)
        if ip_match:
            candidate = ip_match.group(1)
            current_ip = candidate if is_preferred_lan_ip(candidate) else None
            continue
        if current_ip is None:
            continue
        mask_match = re.search(r"(?:Subnet Mask|子网掩码)[^:：]*[:：]\s*(\d+\.\d+\.\d+\.\d+)", line, flags=re.IGNORECASE)
        if not mask_match:
            continue
        prefix_length = _netmask_to_prefix(mask_match.group(1))
        if prefix_length is None:
            current_ip = None
            continue
        interfaces.append(IPv4InterfaceRecord(address=current_ip, prefix_length=prefix_length))
        current_ip = None
    return interfaces


def _list_interfaces_from_ip_addr() -> list[IPv4InterfaceRecord]:
    try:
        completed = subprocess.run(
            ["ip", "-o", "-f", "inet", "addr", "show"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            check=False,
        )
    except OSError:
        return []
    if completed.returncode != 0 or not completed.stdout.strip():
        return []

    interfaces: list[IPv4InterfaceRecord] = []
    for raw_line in completed.stdout.splitlines():
        match = re.search(r"\binet\s+(\d+\.\d+\.\d+\.\d+)/(\d+)\b", raw_line)
        if not match:
            continue
        candidate = match.group(1)
        if not is_preferred_lan_ip(candidate):
            continue
        interfaces.append(IPv4InterfaceRecord(address=candidate, prefix_length=int(match.group(2))))
    return interfaces


def _netmask_to_prefix(mask: str) -> int | None:
    try:
        network = ipaddress.IPv4Network(f"0.0.0.0/{mask}")
    except (ValueError, ipaddress.NetmaskValueError):
        return None
    return int(network.prefixlen)
