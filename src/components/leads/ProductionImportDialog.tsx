import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { SOURCE_LABEL } from "@/data/catalog";
import { parseCsv } from "@/lib/csv";
import { importLeadBatches, listAssignableMembers, type DuplicateAction, type ImportReport, type ImportRow, type MemberOption, type WorkspaceOption } from "@/services/production-leads";
import type { LeadSource } from "@/types";

const FIELDS = [
  ["fullName", "Full name"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["location", "Place"],
  ["position", "Interest"],
  ["source", "Source"],
  ["status", "Stage"],
] as const;

type FieldKey = (typeof FIELDS)[number][0];

function headerText(header: string) {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function guess(headers: string[], aliases: string[], exact = false) {
  const index = headers.findIndex((header) => {
    const text = headerText(header);
    return aliases.some((alias) => (exact ? text === alias : text === alias || text.includes(alias)));
  });
  return index >= 0 ? String(index) : "";
}

export function initialImportMapping(headers: string[]): Record<FieldKey, string> {
  const firstName = guess(headers, ["first name", "firstname"]);
  const lastName = guess(headers, ["last name", "lastname", "surname"]);
  const fullName = guess(headers, ["full name", "contact name"]) || (firstName ? "" : guess(headers, ["name"], true));
  return {
    fullName,
    firstName,
    lastName,
    phone: guess(headers, ["phone", "mobile", "whatsapp"]),
    email: guess(headers, ["email", "e-mail"]),
    location: guess(headers, ["location", "city", "place"]),
    position: guess(headers, ["business name", "position", "interest"]),
    source: guess(headers, ["source"], true),
    status: guess(headers, ["stage", "status"]),
  };
}

function cell(row: string[], index: string | undefined) {
  if (!index) return "";
  const column = Number(index);
  if (!Number.isInteger(column) || column < 0) return "";
  return String(row[column] ?? "").trim();
}

export function leadNameFromRow(row: string[], mapping: Record<string, string>) {
  const full = cell(row, mapping.fullName);
  if (full) return full;
  return [cell(row, mapping.firstName), cell(row, mapping.lastName)].filter(Boolean).join(" ");
}

function rowsToImport(body: string[][], mapping: Record<string, string>, defaultSource: string): ImportRow[] {
  return body.map((row) => ({
    fullName: leadNameFromRow(row, mapping),
    phone: cell(row, mapping.phone),
    email: cell(row, mapping.email),
    location: cell(row, mapping.location),
    position: cell(row, mapping.position),
    source: cell(row, mapping.source) || defaultSource || "other",
    status: cell(row, mapping.status) || "new",
  }));
}

function guessMapping(headers: string[]) {
  return initialImportMapping(headers);
}

async function rowsFromFile(file: File) {
  if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    if (!sheet) return [] as string[][];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];
  }
  return parseCsv(await file.text());
}

export function ProductionImportDialog({
  open,
  workspaces,
  workspaceId,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  workspaces: WorkspaceOption[];
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [targetId, setTargetId] = useState(workspaceId);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<string[][]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [assignedTo, setAssignedTo] = useState("");
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>("skip");
  const [defaultSource, setDefaultSource] = useState<LeadSource>("whatsapp");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const workspace = workspaces.find((item) => item.id === targetId) ?? null;

  useEffect(() => {
    if (!open) return;
    const preferred = workspaces.find((item) => item.id === workspaceId)
      ?? workspaces.find((item) => item.workspaceType === "clinic")
      ?? workspaces[0];
    setTargetId(preferred?.id ?? "");
  }, [open, workspaceId, workspaces]);

  useEffect(() => {
    if (!targetId) return;
    void listAssignableMembers(targetId).then(setMembers).catch(() => setMembers([]));
  }, [targetId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>Choose the desk, then a CSV or Excel file. First name and last name are joined. Blank columns stay blank. Rows are saved in batches of 200.</DialogDescription>
        </DialogHeader>
        <label className="text-[13px] font-medium">
          Desk
          <Select className="mt-1" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </label>
        <label className="mt-3 flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-line px-6 py-8 text-sm text-muted">
          Choose a CSV or XLSX file
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="hidden"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (!next) return;
              void rowsFromFile(next).then((rows) => {
                const head = (rows[0] ?? []).map((cellValue) => String(cellValue ?? ""));
                setFile(next);
                setHeaders(head);
                setPreview(rows.slice(1, 6));
                setRowCount(Math.max(rows.length - 1, 0));
                setMapping(guessMapping(head));
                setReport(null);
                setError("");
              }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not read the file"));
            }}
          />
        </label>
        {file ? <p className="text-sm text-muted">{file.name} · {rowCount.toLocaleString("en-IN")} rows · {workspace?.name ?? "Choose a desk"}</p> : null}
        {headers.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([field, label]) => (
              <label key={field} className="text-[13px] font-medium">
                {label}
                <Select className="mt-1" value={mapping[field] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}>
                  <option value="">Not mapped</option>
                  {headers.map((header, index) => <option key={`${header}-${index}`} value={String(index)}>{header || `Column ${index + 1}`}</option>)}
                </Select>
              </label>
            ))}
            <label className="text-[13px] font-medium">
              Source when the file has no source column
              <Select className="mt-1" value={defaultSource} onChange={(event) => setDefaultSource(event.target.value as LeadSource)}>
                {(Object.entries(SOURCE_LABEL) as Array<[LeadSource, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="text-[13px] font-medium">
              Assign telecaller
              <Select className="mt-1" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
              </Select>
            </label>
            <label className="text-[13px] font-medium">
              Duplicates
              <Select className="mt-1" value={duplicateAction} onChange={(event) => setDuplicateAction(event.target.value as DuplicateAction)}>
                <option value="skip">Skip</option>
                <option value="merge">Merge into the existing lead</option>
                <option value="separate">Import as separate</option>
              </Select>
            </label>
          </div>
        ) : null}
        {preview.length ? (
          <p className="text-xs text-muted">Preview {preview.length} of {rowCount.toLocaleString("en-IN")} rows. {preview.map((row) => leadNameFromRow(row, mapping)).filter(Boolean).join(", ")}</p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {report ? (
          <p className="text-sm">
            Created {report.created}. Skipped {report.skipped}. Merged {report.merged}. Separate {report.separate}. Invalid {report.invalid.length}.
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!file || busy || !workspace}
            onClick={() => {
              if (!file || !workspace) return;
              setBusy(true);
              void rowsFromFile(file)
                .then((rows) => importLeadBatches(workspace, rowsToImport(rows.slice(1), mapping, defaultSource), assignedTo || null, duplicateAction))
                .then((next) => {
                  setReport(next);
                  onImported();
                })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Import failed"))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Importing…" : "Import"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
