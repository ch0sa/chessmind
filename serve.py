#!/usr/bin/env python3
"""
ChessMind - Local Chess Analysis Server
=======================================
A lightweight, zero-dependency Python 3 HTTP and HTTPS server for serving
ChessMind across the local network with multi-threaded Stockfish WASM support
and voice control over HTTPS.
"""

import argparse
import http.server
import os
import shutil
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
import time
from functools import partial
from pathlib import Path

# Ensure UTF-8 output on Windows consoles or redirected streams (prevents cp1252 charmap errors)
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass



def get_local_ip() -> str:
    """
    Auto-detect the machine's primary local LAN IP address.
    Falls back to socket.gethostbyname or 127.0.0.1 if offline.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Connecting to a public non-routable address forces the OS
        # to pick the primary outgoing network interface without sending packets
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            ip = '127.0.0.1'
    finally:
        s.close()
    return ip


def find_openssl() -> str | None:
    """
    Locate the openssl executable across PATH and common installation directories
    on Windows, Linux, and macOS.
    """
    path_openssl = shutil.which("openssl")
    if path_openssl:
        return path_openssl

    candidates = [
        # Windows Git locations
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Git", "usr", "bin", "openssl.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Git", "usr", "bin", "openssl.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Git", "usr", "bin", "openssl.exe"),
        # Windows standalone OpenSSL
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "OpenSSL-Win64", "bin", "openssl.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "OpenSSL-Win32", "bin", "openssl.exe"),
        r"C:\OpenSSL-Win64\bin\openssl.exe",
        r"C:\OpenSSL\bin\openssl.exe",
        # Unix locations
        "/usr/bin/openssl",
        "/usr/local/bin/openssl",
        "/opt/homebrew/bin/openssl",
        "/usr/pkg/bin/openssl",
        "/opt/local/bin/openssl",
    ]

    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate

    return None


def ensure_self_signed_cert(cert_dir: str, local_ip: str) -> tuple[str, str]:
    """
    Ensure a self-signed TLS certificate and private key exist in cert_dir.
    If not, generate them using OpenSSL with proper Subject Alternative Names (SAN).
    """
    os.makedirs(cert_dir, exist_ok=True)
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")

    if os.path.isfile(cert_path) and os.path.isfile(key_path):
        if os.path.getsize(cert_path) > 0 and os.path.getsize(key_path) > 0:
            return cert_path, key_path

    openssl_bin = find_openssl()
    if not openssl_bin:
        raise RuntimeError(
            "OpenSSL executable was not found on your system.\n"
            "To use HTTPS, please install OpenSSL (or Git for Windows),\n"
            f"or manually place 'cert.pem' and 'key.pem' in '{cert_dir}'.\n"
            "Alternatively, launch with --no-ssl to run in HTTP-only mode."
        )

    # Prepare Subject Alternative Names (SAN) for localhost and LAN IP
    san_entries = ["DNS:localhost", "IP:127.0.0.1"]
    if local_ip and local_ip not in ("127.0.0.1", "0.0.0.0"):
        san_entries.append(f"IP:{local_ip}")
    san_arg = ",".join(san_entries)

    print(f"Generating self-signed TLS certificate in {cert_dir}...")
    cmd_with_addext = [
        openssl_bin, "req", "-x509",
        "-newkey", "rsa:2048",
        "-nodes",
        "-keyout", key_path,
        "-out", cert_path,
        "-days", "365",
        "-subj", "/CN=localhost/O=ChessMind/OU=Development",
        "-addext", f"subjectAltName={san_arg}",
    ]

    try:
        subprocess.run(cmd_with_addext, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError:
        # Fallback for older OpenSSL releases without -addext support
        cnf_path = os.path.join(cert_dir, "openssl.cnf")
        cnf_content = (
            "[req]\n"
            "distinguished_name = req_distinguished_name\n"
            "x509_extensions = v3_req\n"
            "prompt = no\n\n"
            "[req_distinguished_name]\n"
            "CN = localhost\n\n"
            "[v3_req]\n"
            "keyUsage = critical, digitalSignature, keyEncipherment\n"
            "extendedKeyUsage = serverAuth\n"
            f"subjectAltName = {san_arg}\n"
        )
        try:
            with open(cnf_path, "w", encoding="utf-8") as f:
                f.write(cnf_content)
            cmd_cnf = [
                openssl_bin, "req", "-x509",
                "-newkey", "rsa:2048",
                "-nodes",
                "-keyout", key_path,
                "-out", cert_path,
                "-days", "365",
                "-config", cnf_path,
                "-extensions", "v3_req",
            ]
            subprocess.run(cmd_cnf, check=True, capture_output=True, text=True)
        finally:
            if os.path.exists(cnf_path):
                try:
                    os.remove(cnf_path)
                except OSError:
                    pass

    return cert_path, key_path


class ChessMindRequestHandler(http.server.SimpleHTTPRequestHandler):
    """
    Custom HTTP request handler with:
    - Accurate MIME types for WASM, modern JS modules, SVG, etc.
    - CORS headers allowing access from any client
    - SharedArrayBuffer cross-origin isolation headers (COOP / COEP)
    - No-cache headers for instant local development feedback
    """
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css; charset=utf-8',
        '.wasm': 'application/wasm',
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.map': 'application/json',
        '.txt': 'text/plain; charset=utf-8',
    })

    def end_headers(self):
        # Allow cross-origin access from any local device
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD')
        self.send_header('Access-Control-Allow-Headers', '*')

        # Crucial security headers required for SharedArrayBuffer in modern browsers
        # Without these, Stockfish WASM cannot run multi-threaded workers
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')

        # Development cache control
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')

        super().end_headers()

    def do_OPTIONS(self):
        """Respond to preflight CORS checks."""
        self.send_response(200, "OK")
        self.end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in self.extensions_map:
            return self.extensions_map[ext]
        return super().guess_type(path)

    def log_message(self, format, *args):
        """Timestamped single-line request logger."""
        timestamp = time.strftime('%H:%M:%S')
        sys.stdout.write(f"[{timestamp}] {self.address_string()} - {format % args}\n")
        sys.stdout.flush()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """
    Multi-threaded HTTP Server that handles requests concurrently
    and cleanly suppresses harmless client disconnection errors.
    """
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        exc_type, _, _ = sys.exc_info()
        # Suppress TLS handshake drops and client resets
        if exc_type in (ssl.SSLError, ConnectionResetError, BrokenPipeError):
            return
        super().handle_error(request, client_address)


def print_banner(http_port: int, network_ip: str, https_port: int | None = None) -> None:
    """
    Print the startup banner matching the ChessMind specification with aligned borders.
    """
    content_lines = [
        "ChessMind - Local Chess Analysis Server",
        "---",
        f"Local:    http://localhost:{http_port}",
        f"Network:  http://{network_ip}:{http_port}",
    ]

    if https_port:
        content_lines.append(f"HTTPS:    https://{network_ip}:{https_port}")

    content_lines.extend([
        "",
        "Voice control requires HTTPS on remote devices",
        "Press Ctrl+C to stop",
    ])

    # Determine required width (minimum 50 chars inside borders)
    raw_lengths = [len(line) for line in content_lines if line != "---"]
    inner_width = max(50, max(raw_lengths) + 2)

    border_top = "╔" + "═" * inner_width + "╗"
    border_mid = "╠" + "═" * inner_width + "╣"
    border_bot = "╚" + "═" * inner_width + "╝"

    banner = [border_top]
    for line in content_lines:
        if line == "---":
            banner.append(border_mid)
        else:
            # 2 leading spaces padding, padded to inner_width
            padded = f"  {line}".ljust(inner_width)
            banner.append(f"║{padded}║")
    banner.append(border_bot)

    banner_str = "\n" + "\n".join(banner) + "\n"
    try:
        print(banner_str, flush=True)
    except UnicodeEncodeError:
        # Fallback to pure ASCII border for legacy terminals
        ascii_top = "+" + "-" * inner_width + "+"
        ascii_mid = "+" + "-" * inner_width + "+"
        ascii_bot = "+" + "-" * inner_width + "+"
        ascii_banner = [ascii_top]
        for line in content_lines:
            if line == "---":
                ascii_banner.append(ascii_mid)
            else:
                padded = f"  {line}".ljust(inner_width)
                ascii_banner.append(f"|{padded}|")
        ascii_banner.append(ascii_bot)
        print("\n" + "\n".join(ascii_banner) + "\n", flush=True)


def parse_args():
    parser = argparse.ArgumentParser(
        description="ChessMind Local HTTP and HTTPS Server with WASM and Voice Support",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Port to serve HTTP traffic",
    )
    parser.add_argument(
        "--ssl-port",
        type=int,
        default=8443,
        help="Port to serve HTTPS traffic",
    )
    parser.add_argument(
        "--no-ssl",
        action="store_true",
        help="Disable HTTPS server and run HTTP only",
    )
    parser.add_argument(
        "--bind",
        type=str,
        default="0.0.0.0",
        help="IP address to bind the server to (0.0.0.0 allows LAN access)",
    )
    parser.add_argument(
        "--dir",
        type=str,
        default=os.path.dirname(os.path.abspath(__file__)),
        help="Directory to serve files from",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    serve_dir = os.path.abspath(args.dir)

    if not os.path.isdir(serve_dir):
        print(f"Error: Directory '{serve_dir}' does not exist.", file=sys.stderr)
        sys.exit(1)

    local_ip = get_local_ip()
    handler_factory = partial(ChessMindRequestHandler, directory=serve_dir)

    # Initialize HTTP Server
    try:
        http_server = ThreadingHTTPServer((args.bind, args.port), handler_factory)
    except OSError as e:
        print(f"Error: Could not bind HTTP server to {args.bind}:{args.port} - {e}", file=sys.stderr)
        sys.exit(1)

    https_server = None
    if not args.no_ssl:
        certs_dir = os.path.join(serve_dir, "certs")
        try:
            cert_file, key_file = ensure_self_signed_cert(certs_dir, local_ip)
            ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_ctx.load_cert_chain(certfile=cert_file, keyfile=key_file)

            https_server = ThreadingHTTPServer((args.bind, args.ssl_port), handler_factory)
            https_server.socket = ssl_ctx.wrap_socket(https_server.socket, server_side=True)
        except Exception as e:
            print(f"Warning: Failed to initialize HTTPS server ({e}).", file=sys.stderr)
            print("Running in HTTP-only mode.\n", file=sys.stderr)
            https_server = None

    # Print startup banner
    active_ssl_port = args.ssl_port if https_server is not None else None
    print_banner(http_port=args.port, network_ip=local_ip, https_port=active_ssl_port)

    # Launch servers on background threads
    http_thread = threading.Thread(
        target=http_server.serve_forever,
        name="ChessMind-HTTP",
        daemon=True,
    )
    http_thread.start()

    if https_server:
        https_thread = threading.Thread(
            target=https_server.serve_forever,
            name="ChessMind-HTTPS",
            daemon=True,
        )
        https_thread.start()

    # Main loop waiting for Ctrl+C
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping ChessMind server...")
    finally:
        if http_server:
            http_server.shutdown()
            http_server.server_close()
        if https_server:
            https_server.shutdown()
            https_server.server_close()
        print("ChessMind server shut down successfully.")


if __name__ == "__main__":
    main()
