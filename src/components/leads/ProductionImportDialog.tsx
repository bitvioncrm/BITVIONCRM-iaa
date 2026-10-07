import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { parseCsv } from "@/lib/csv";
import { importLeadBatches, type DuplicateAction, type ImportReport, type ImportRow, type MemberOption, type WorkspaceOption } from "@/services/production-leads";

const FIELDS = ["fullName", "phone", "email", "location", "position", "source", "status"] as const;

function guess(headers: string[], label: string) {
  const needle = label.toLowerCase();
  const index = headers.findIndex((header) => header.trim().toLowerCase().includes(needle));
  return index >= 0 ? String(index) : "";
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
  workspace,
  members,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  workspace: WorkspaceOption;
  members: MemberOption[];
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<string[][]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [assignedTo, setAssignedTo] = useState("");
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>("skip");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>CSV or Excel. Rows are checked and inserted in batches of 200. The full sheet is not kept on the lead list.</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-line px-6 py-8 text-sm text-muted">
          Choose a CSV or XLSX file
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="hidden"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (!next) return;
              void rowsFromFile(next).then((rows) => {
                const head = (rows[0] ?? []).map((cell) => String(cell ?? ""));
                setFile(next);
                setHeaders(head);
                setPreview(rows.slice(1, 6));
                setRowCount(Math.max(rows.length - 1, 0));
                setMapping({
                  fullName: guess(head, "name"),
                  phone: guess(head, "phone"),
                  email: guess(head, "email"),
                  location: guess(head, "location"),
                  position: guess(head, "position"),
                  source: guess(head, "source"),
                  status: guess(head, "stage") || guess(head, "status"),
                });
                setReport(null);
                setError("");
              }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not read the file"));
            }}
          />
        </label>
        {file ? <p className="text-sm text-muted">{file.name} · {rowCount.toLocaleString("en-IN")} rows · workspace {workspace.name}</p> : null}
        {headers.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <label key={field} className="text-[13px] font-medium">
                {field}
                <Select className="mt-1" value={mapping[field] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}>
                  <option value="">Not mapped</option>
                  {headers.map((header, index) => <option key={`${header}-${index}`} value={String(index)}>{header || `Column ${index + 1}`}</option>)}
                </Select>
              </label>
            ))}
            <label className="text-[13px] font-medium">
              Assign BDE
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
          <p className="text-xs text-muted">Preview {preview.length} of {rowCount.toLocaleString("en-IN")} rows. {preview.map((row) => row[Number(mapping.fullName ?? 0)]).filter(Boolean).join(", ")}</p>
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
            disabled={!file || busy}
            onClick={() => {
              if (!file) return;
              setBusy(true);
              void rowsFromFile(file)
                .then((rows) => {
                  const body = rows.slice(1);
                  const mapped: ImportRow[] = body.map((row) => ({
                    fullName: row[Number(mapping.fullName ?? -1)]?.trim() ?? "",
                    phone: row[Number(mapping.phone ?? -1)]?.trim() ?? "",
                    email: row[Number(mapping.email ?? -1)]?.trim() ?? "",
                    location: row[Number(mapping.location ?? -1)]?.trim() ?? "",
                    position: row[Number(mapping.position ?? -1)]?.trim() ?? "",
                    source: row[Number(mapping.source ?? -1)]?.trim() ?? "other",
                    status: row[Number(mapping.status ?? -1)]?.trim() ?? "new",
                  }));
                  return importLeadBatches(workspace, mapped, assignedTo || null, duplicateAction);
                })
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
