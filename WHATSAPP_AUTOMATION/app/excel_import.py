from __future__ import annotations

import csv
import io
from typing import Any


def rows_from_csv_bytes(raw: bytes) -> list[dict[str, Any]]:
    text = raw.decode("utf-8-sig", errors="ignore")
    return list(csv.DictReader(io.StringIO(text)))


def rows_from_excel_bytes(raw: bytes) -> list[dict[str, Any]]:
    from openpyxl import load_workbook

    wb = load_workbook(filename=io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    headers = [str(h or "").strip() for h in next(rows_iter)]
    out: list[dict[str, Any]] = []
    for values in rows_iter:
        item: dict[str, Any] = {}
        empty = True
        for i, key in enumerate(headers):
            if not key:
                continue
            val = values[i] if i < len(values) else None
            if val is not None and str(val).strip() != "":
                empty = False
            item[key] = "" if val is None else val
        if not empty:
            out.append(item)
    return out
