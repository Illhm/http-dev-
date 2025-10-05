#!/usr/bin/env python3
"""Export ReqRes DevTools captures into a readable ZIP archive.

This script mirrors the export logic from the dashboard of the
ReqRes DevTools Lite extension and is a Python translation of the
JavaScript exporter contained in `dashboard.js`.

The script expects a JSON file that contains a list of request records
as produced by the extension background worker. Each record should mimic
the shape generated in `bg.js` (fields such as `seq`, `url`,
`requestHeaders`, `responseHeaders`, `responseBodyRaw`, etc.).

Example usage:

    python tools/export_requests.py samples/reqres-sample.json \
        --output reqres_readable.zip --kinds xhr js --text login

The resulting archive matches the layout documented in
`docs/reqres-devtools-lite-report.md` and can be inspected manually or
shared with teammates.
"""
from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import re
import textwrap
import urllib.parse
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence


DEFAULT_KINDS = [
    "xhr",
    "js",
    "css",
    "img",
    "media",
    "font",
    "doc",
    "ws",
    "wasm",
    "manifest",
    "other",
]
README_CONTENT = textwrap.dedent(
    """
    # Export Req/Res (Readable)

    Arsip ini dibuat oleh skrip Python `export_requests.py`. Struktur berkasnya
    mengikuti ekspor ZIP dari dashboard ReqRes DevTools Lite.

    Untuk setiap request yang dipilih tersedia berkas:

    - 00-meta.txt — ringkasan metadata dan informasi umum.
    - 01-request-headers.txt — header permintaan.
    - 02-request-body.* — isi permintaan, format mengikuti content-type.
    - 03-response-headers.txt — header respon.
    - 04-response-body.* — isi respon (teks ataupun biner).
    - 05-response-info.json — metadata tambahan (timing, ukuran, error, dll).

    File `index.csv` dan `index.md` berisi ringkasan seluruh entri.
    """
)


@dataclass
class RequestRecord:
    """Normalized representation of a request/response pair."""

    raw: dict

    @property
    def seq(self) -> int:
        seq = self.raw.get("seq")
        if isinstance(seq, int):
            return seq
        try:
            return int(seq)
        except (TypeError, ValueError):
            return 0

    @property
    def url(self) -> str:
        return str(self.raw.get("url", ""))

    @property
    def method(self) -> str:
        return str(self.raw.get("method", "GET"))

    @property
    def status(self) -> Optional[int]:
        status = self.raw.get("status")
        try:
            return int(status)
        except (TypeError, ValueError):
            return None

    @property
    def status_text(self) -> str:
        return str(self.raw.get("statusText") or "")

    @property
    def mime_type(self) -> str:
        return str(self.raw.get("mimeType") or "")

    @property
    def resource_type(self) -> str:
        return str(self.raw.get("resourceType") or "")

    @property
    def request_headers(self) -> Sequence[dict]:
        headers = self.raw.get("requestHeaders") or []
        if isinstance(headers, list):
            return headers
        if isinstance(headers, dict):
            return [
                {"name": name, "value": str(value)}
                for name, value in headers.items()
            ]
        return []

    @property
    def response_headers(self) -> Sequence[dict]:
        headers = self.raw.get("responseHeaders") or []
        if isinstance(headers, list):
            return headers
        if isinstance(headers, dict):
            return [
                {"name": name, "value": str(value)}
                for name, value in headers.items()
            ]
        return []

    @property
    def request_body_text(self) -> str:
        return str(self.raw.get("requestBodyText") or "")

    @property
    def response_body_raw(self) -> Optional[str]:
        body = self.raw.get("responseBodyRaw")
        if body is None:
            return None
        return str(body)

    @property
    def response_body_encoding(self) -> str:
        enc = self.raw.get("responseBodyEncoding")
        return str(enc or "utf-8").lower()

    @property
    def body_size(self) -> Optional[int]:
        size = self.raw.get("bodySize")
        try:
            return int(size)
        except (TypeError, ValueError):
            return None

    @property
    def started_date_time(self) -> str:
        return str(self.raw.get("startedDateTime") or "")

    @property
    def time_seconds(self) -> Optional[float]:
        value = self.raw.get("time")
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @property
    def error_text(self) -> str:
        return str(self.raw.get("errorText") or "")

    @property
    def canceled(self) -> bool:
        return bool(self.raw.get("canceled", False))

    def guess_kind(self) -> str:
        type_hint = self.resource_type.lower()
        if type_hint:
            if "xhr" in type_hint or "fetch" in type_hint:
                return "xhr"
            if "script" in type_hint:
                return "js"
            if "stylesheet" in type_hint:
                return "css"
            if "image" in type_hint:
                return "img"
            if "media" in type_hint:
                return "media"
            if "font" in type_hint:
                return "font"
            if "document" in type_hint:
                return "doc"
            if "websocket" in type_hint:
                return "ws"
            if "wasm" in type_hint:
                return "wasm"
            if "manifest" in type_hint:
                return "manifest"
        mime = self.mime_type.lower()
        if mime.startswith("image/"):
            return "img"
        if mime.startswith("video/") or mime.startswith("audio/"):
            return "media"
        if mime == "text/css":
            return "css"
        if "javascript" in mime:
            return "js"
        if "json" in mime:
            return "xhr"
        if mime == "text/html":
            return "doc"
        if mime == "application/wasm":
            return "wasm"
        if "font" in mime:
            return "font"
        if "manifest" in mime:
            return "manifest"
        return "other"

    def matches_filters(self, kinds: Sequence[str], hide_data_url: bool, text_filter: str) -> bool:
        if hide_data_url and self.url.startswith("data:"):
            return False
        if kinds and self.guess_kind() not in kinds:
            return False
        if text_filter:
            blob_parts = [
                self.url,
                self.mime_type,
                self.method,
                str(self.status or ""),
                self.request_body_text,
                self.response_body_raw or "",
            ]
            blob = " ".join(blob_parts).lower()
            if text_filter not in blob:
                return False
        return True

    def build_folder_name(self) -> str:
        seq = max(self.seq, 0)
        padded = f"{seq:05d}"
        method = sanitize(self.method.upper() or "GET")
        try:
            url = urllib.parse.urlparse(self.url)
        except ValueError:
            url = urllib.parse.urlparse("")
        host = sanitize(url.hostname or "unknown")
        path = sanitize(url.path or "")[-60:]
        base = f"{padded}__{method}__{host}{path}"
        base = re.sub(r"_+", "_", base).strip("_")
        return base or f"{padded}__{method}"

    def request_body_extension(self) -> str:
        content_type = ""
        for header in self.request_headers:
            name = str(header.get("name") or "").lower()
            if name == "content-type":
                content_type = str(header.get("value") or "")
                break
        return guess_extension(content_type, "text")

    def response_body_bytes(self) -> bytes:
        body = self.response_body_raw or ""
        if self.response_body_encoding == "base64":
            try:
                return base64.b64decode(body)
            except (base64.binascii.Error, ValueError):
                return b""
        return body.encode("utf-8", errors="replace")


def sanitize(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value or "").strip("_")


def guess_extension(mime: str, encoding: str) -> str:
    mime = (mime or "").lower()
    if "json" in mime:
        return ".json"
    if mime == "text/html":
        return ".html"
    if "xml" in mime:
        return ".xml"
    if mime == "text/plain":
        return ".txt"
    if mime.startswith("image/"):
        return f".{mime.split('/')[1].split(';')[0]}"
    if mime.startswith("video/"):
        return f".{mime.split('/')[1].split(';')[0]}"
    if mime.startswith("audio/"):
        return f".{mime.split('/')[1].split(';')[0]}"
    if mime == "application/wasm":
        return ".wasm"
    if mime.startswith("text/"):
        subtype = mime.split("/", 1)[1].split(";")[0]
        return f".{subtype}"
    return ".bin" if encoding == "base64" else ".txt"


def format_headers(headers: Sequence[dict]) -> str:
    return "\n".join(
        f"{str(h.get('name') or '')}: {str(h.get('value') or '')}" for h in headers
    )


def load_records(path: Path) -> List[RequestRecord]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        if "entries" in data and isinstance(data["entries"], list):
            items = data["entries"]
        elif "records" in data and isinstance(data["records"], list):
            items = data["records"]
        else:
            items = [data]
    elif isinstance(data, list):
        items = data
    else:
        raise ValueError("Input JSON must be a list or an object containing 'entries'.")
    return [RequestRecord(raw=item) for item in items]


def filter_records(
    records: Iterable[RequestRecord],
    kinds: Sequence[str],
    hide_data_url: bool,
    text_filter: str,
) -> List[RequestRecord]:
    filtered: List[RequestRecord] = []
    for record in records:
        if record.matches_filters(kinds, hide_data_url, text_filter):
            filtered.append(record)
    return filtered


def write_index_csv(records: Sequence[RequestRecord]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["seq", "timestamp", "method", "status", "mime", "size", "url"])
    for record in records:
        writer.writerow(
            [
                record.seq,
                record.started_date_time,
                record.method,
                record.status or "",
                record.mime_type,
                record.body_size or 0,
                record.url,
            ]
        )
    return buffer.getvalue().encode("utf-8")


def write_index_md(records: Sequence[RequestRecord]) -> bytes:
    lines = ["| seq | method | status | mime | size | url |", "|---:|:--|:--:|:--|--:|:--|"]
    for record in records:
        lines.append(
            "| {seq} | {method} | {status} | {mime} | {size} | {url} |".format(
                seq=record.seq,
                method=record.method,
                status=record.status or "",
                mime=record.mime_type or "",
                size=record.body_size or 0,
                url=record.url,
            )
        )
    return "\n".join(lines).encode("utf-8")


def write_meta_txt(record: RequestRecord) -> bytes:
    lines = [
        f"URL: {record.url}",
        f"Method: {record.method}",
        f"Status: {record.status or ''} {record.status_text}".rstrip(),
        f"MIME: {record.mime_type or '-'}",
        f"Size: {record.body_size or 0}",
        f"Started: {record.started_date_time}",
        f"Time(ms): {int(round((record.time_seconds or 0.0) * 1000))}",
        f"Category: {record.guess_kind()}",
    ]
    error = record.error_text
    if error:
        lines.append(f"Error: {error}")
    if record.canceled:
        lines.append("Canceled: true")
    return "\n".join(lines).encode("utf-8")


def write_response_info(record: RequestRecord) -> bytes:
    payload = {
        key: record.raw.get(key)
        for key in [
            "timing",
            "encodedDataLength",
            "errorText",
            "canceled",
            "resourceType",
        ]
        if key in record.raw
    }
    payload.update(
        {
            "bodySize": record.body_size,
            "responseBodyEncoding": record.response_body_encoding,
        }
    )
    return json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")


def build_zip(records: Sequence[RequestRecord], output_path: Path) -> None:
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.md", README_CONTENT)
        zf.writestr("index.csv", write_index_csv(records))
        zf.writestr("index.md", write_index_md(records))
        for record in records:
            folder = record.build_folder_name()
            zf.writestr(f"{folder}/00-meta.txt", write_meta_txt(record))
            zf.writestr(
                f"{folder}/01-request-headers.txt",
                format_headers(record.request_headers).encode("utf-8"),
            )
            zf.writestr(
                f"{folder}/02-request-body{record.request_body_extension()}",
                record.request_body_text.encode("utf-8"),
            )
            zf.writestr(
                f"{folder}/03-response-headers.txt",
                format_headers(record.response_headers).encode("utf-8"),
            )
            zf.writestr(
                f"{folder}/04-response-body{guess_extension(record.mime_type, record.response_body_encoding)}",
                record.response_body_bytes(),
            )
            zf.writestr(
                f"{folder}/05-response-info.json",
                write_response_info(record),
            )


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export ReqRes DevTools captures to a ZIP archive")
    parser.add_argument("input", type=Path, help="Path to JSON capture produced by the extension")
    parser.add_argument("--output", "-o", type=Path, default=Path("reqres_readable.zip"))
    parser.add_argument(
        "--kinds",
        nargs="*",
        default=None,
        help="Kinds to include (xhr, js, css, img, media, font, doc, ws, wasm, manifest, other)",
    )
    parser.add_argument("--hide-data-url", action="store_true", help="Exclude data: URLs from the export")
    parser.add_argument("--text", default="", help="Case-insensitive substring filter")
    parser.add_argument("--limit", type=int, default=None, help="Optional limit on number of records to export")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    records = load_records(args.input)
    kinds = [kind.lower() for kind in (args.kinds or DEFAULT_KINDS)]
    text_filter = args.text.lower().strip()
    filtered = filter_records(records, kinds, args.hide_data_url, text_filter)
    filtered.sort(key=lambda r: (r.seq, r.url))
    if args.limit is not None:
        filtered = filtered[: args.limit]
    if not filtered:
        raise SystemExit("No records matched the provided filters.")
    build_zip(filtered, args.output)
    print(f"Wrote {len(filtered)} record(s) to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
