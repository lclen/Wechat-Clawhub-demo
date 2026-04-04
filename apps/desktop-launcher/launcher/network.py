from __future__ import annotations

import ipaddress
import socket


LOOPBACK_HOST = "127.0.0.1"
PROBE_TARGETS: tuple[str, ...] = ("8.8.8.8", "1.1.1.1")


def detect_lan_ip() -> str | None:
    candidates: list[str] = []
    preferred_subnet = ipaddress.ip_network("192.168.0.0/24")
    try:
        host_name = socket.gethostname()
        for _, _, _, _, sockaddr in socket.getaddrinfo(host_name, None, family=socket.AF_INET):
            ip = sockaddr[0]
            if not is_preferred_lan_ip(ip):
                continue
            # 优先返回 192.168.0.x 网段
            if ipaddress.ip_address(ip) in preferred_subnet:
                return ip
            candidates.append(ip)
    except OSError:
        pass

    for probe in PROBE_TARGETS:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect((probe, 80))
                ip = sock.getsockname()[0]
                if is_preferred_lan_ip(ip):
                    if ipaddress.ip_address(ip) in preferred_subnet:
                        return ip
                    candidates.append(ip)
        except OSError:
            continue

    return candidates[0] if candidates else None


def preferred_gateway_base_url(port: int) -> str:
    host = detect_lan_ip() or LOOPBACK_HOST
    return f"http://{host}:{port}"


def launcher_cors_origins(port: int) -> list[str]:
    origins = {
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
    }
    lan_ip = detect_lan_ip()
    if lan_ip:
        origins.add(f"http://{lan_ip}:{port}")
    return sorted(origins)


def is_preferred_lan_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    # 排除 RFC 2544 基准测试保留段 198.18.0.0/15，不是真实局域网地址
    if ip in ipaddress.ip_network("198.18.0.0/15"):
        return False
    rfc1918 = (
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
    )
    return any(ip in net for net in rfc1918)


def is_usable_ipv4(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    return not ip.is_loopback and not ip.is_multicast and not ip.is_unspecified
