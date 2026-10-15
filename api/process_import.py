"""Vercel Python Function: limpa uma importação já salva no Supabase Storage.

O endpoint é chamado apenas pelo servidor, com SUPABASE_SERVICE_ROLE_KEY.
O arquivo bruto nunca é alterado: registros normalizados recebem source_row e import_id.
"""
from http.server import BaseHTTPRequestHandler
from io import BytesIO
import json
import os
import re
import unicodedata
from urllib.parse import quote

import pandas as pd
import requests

NUMERIC_COLUMNS = [
    "planned_minutes", "operating_minutes", "technical_speed", "average_speed",
    "total_count", "good_count", "reject_count", "setup_minutes", "breakdown_minutes",
    "cleaning_minutes", "adjustments_minutes", "material_shortage_minutes",
    "supply_shortage_minutes", "microstops_minutes"
]

def clean_header(value):
    value = unicodedata.normalize("NFD", str(value)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", value.lower().replace("_", " ").replace("-", " ")).strip()

def map_columns(columns):
    aliases = {
        "registro": "source_record", "data": "production_date", "turno": "shift", "maquina": "machine",
        "grupo": "machine_group", "produto": "product", "ordem producao": "production_order",
        "tempo disponivel (min)": "planned_minutes", "tempo em operacao (min)": "operating_minutes",
        "velocidade media": "average_speed", "producao total (un)": "total_count",
        "producao boa (un)": "good_count", "refugo e retrabalho (un)": "reject_count",
        "setup (min)": "setup_minutes", "quebra manutencao (min)": "breakdown_minutes",
        "limpeza (min)": "cleaning_minutes", "ajustes (min)": "adjustments_minutes",
        "falta materia prima (min)": "material_shortage_minutes", "falta insumos (min)": "supply_shortage_minutes",
        "microparadas (min)": "microstops_minutes", "motivo refugo": "scrap_reason",
        "contexto": "context", "preventiva excluida (min)": "preventive_excluded_minutes"
    }
    mapped = {}
    for source in columns:
        key = clean_header(source)
        if "velocidade tecnica" in key or "capacidade maxima" in key:
            mapped[source] = "technical_speed"
        elif key in aliases:
            mapped[source] = aliases[key]
    return mapped

def validate_and_normalize(raw, import_id):
    mapping = map_columns(raw.columns)
    frame = raw.rename(columns=mapping)[list(mapping.values())].copy()
    frame["source_row"] = range(2, len(frame) + 2)
    frame["import_id"] = import_id
    if "production_date" in frame:
        frame["production_date"] = pd.to_datetime(frame["production_date"], errors="coerce").dt.date.astype("string")
    for column in NUMERIC_COLUMNS:
        if column in frame:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["quality_status"] = "approved"
    required = ["production_date", "machine", "planned_minutes", "operating_minutes", "technical_speed", "total_count", "good_count"]
    missing = [column for column in required if column not in frame]
    if missing:
        frame["quality_status"] = "needs_mapping"
    else:
        bad = frame[required].isna().any(axis=1)
        negative = frame[[c for c in NUMERIC_COLUMNS if c in frame]].lt(0).any(axis=1)
        time_issue = frame["operating_minutes"] > frame["planned_minutes"]
        frame.loc[bad | negative | time_issue, "quality_status"] = "needs_review"
    return frame.where(pd.notna(frame), None), mapping, missing

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            expected = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            if not expected or self.headers.get("x-import-secret") != expected:
                self._send(401, {"status": "unauthorized"})
                return
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or "{}")
            import_id, storage_path = payload.get("import_id"), payload.get("storage_path")
            if not import_id or not storage_path:
                raise ValueError("import_id and storage_path are required")
            # New Supabase projects provide sb_secret keys. The legacy name is
            # accepted only to keep existing deployments working during migration.
            url = os.environ["SUPABASE_URL"]
            key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
            headers = {"Authorization": f"Bearer {key}", "apikey": key}
            source = requests.get(f"{url}/storage/v1/object/gap-imports/{quote(storage_path)}", headers=headers, timeout=45)
            source.raise_for_status()
            workbook = pd.ExcelFile(BytesIO(source.content))
            sheet = payload.get("sheet") or workbook.sheet_names[0]
            cleaned, mapping, missing = validate_and_normalize(pd.read_excel(workbook, sheet_name=sheet), import_id)
            rows = cleaned.to_dict(orient="records")
            # Store every normalized row for auditability. SQL OEE views use only
            # approved rows, while needs_review and needs_mapping remain visible.
            if rows:
                inserted = requests.post(f"{url}/rest/v1/production_records", headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"}, json=rows, timeout=45)
                inserted.raise_for_status()
            approved_count = sum(row["quality_status"] == "approved" for row in rows)
            requests.patch(f"{url}/rest/v1/import_jobs?id=eq.{import_id}", headers={**headers, "Content-Type": "application/json"}, json={"status": "completed", "total_rows": len(rows), "accepted_rows": approved_count, "rejected_rows": len(rows)-approved_count, "mapping": mapping, "issues": {"missing_columns": missing}}, timeout=30).raise_for_status()
            self._send(200, {"status": "completed", "rows": len(rows), "accepted": approved_count, "rejected": len(rows)-approved_count, "mapping": mapping, "missing": missing})
        except Exception as exc:
            # The route itself must never reveal credentials. The job remains
            # auditable and its error can be inspected in Vercel logs.
            self._send(400, {"status": "failed", "error": str(exc)})

    def _send(self, code, payload):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload, default=str).encode())
