import { useEffect, useState } from "react";
import {
  documentTypeLabel,
  listStudentFile,
  removeDocument,
  signedDocumentUrl,
  STUDENT_DOCUMENT_TYPES,
  updateDocument,
  uploadPrivateFile,
} from "@/services/production-ops";

type FileRow = Awaited<ReturnType<typeof listStudentFile>>;

function formatBytes(value: number) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function StudentFile({ organizationId, workspaceId, studentId, onError, onNotice }: {
  organizationId: string;
  workspaceId: string;
  studentId: string;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  const [file, setFile] = useState<FileRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<string>("aadhaar");
  const [chosen, setChosen] = useState<File | null>(null);

  const load = () => {
    void listStudentFile(workspaceId, studentId).then(setFile).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load the student file"));
  };

  useEffect(() => {
    setFile(null);
    setChosen(null);
    setCategory("aadhaar");
    void listStudentFile(workspaceId, studentId).then(setFile).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load the student file"));
  }, [onError, studentId, workspaceId]);

  const openFile = (path: string) => {
    void signedDocumentUrl(path).then((url) => window.open(url, "_blank", "noopener")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not open the file"));
  };

  const saveUpload = () => {
    if (!chosen) {
      onError("Choose a PDF, JPG, JPEG, PNG, or WEBP file.");
      return;
    }
    setBusy(true);
    void uploadPrivateFile({
      organizationId,
      workspaceId,
      entityType: "student",
      entityId: studentId,
      file: chosen,
      category,
    })
      .then((sizes) => {
        const saved = sizes.optimizedSize < sizes.originalSize
          ? `Document saved. Reduced from ${formatBytes(sizes.originalSize)} to ${formatBytes(sizes.optimizedSize)}.`
          : "Document saved on this student.";
        onNotice?.(saved);
        setChosen(null);
        load();
      })
      .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not upload the document"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-line bg-white p-3">
        <div>
          <h3 className="text-sm font-semibold">Government IDs and documents</h3>
          <p className="mt-1 text-xs text-muted">Upload Aadhaar, PAN, other IDs, or academic files as PDF, JPG, or JPEG. Images are compressed automatically.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">Document type
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
              {STUDENT_DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-sm">File
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              className="mt-1 w-full text-sm"
              disabled={busy}
              onChange={(event) => {
                setChosen(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            {chosen ? <span className="mt-1 block text-xs text-muted">{chosen.name} · {formatBytes(chosen.size)}</span> : null}
          </label>
        </div>
        <button type="button" disabled={busy || !chosen} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white disabled:opacity-60" onClick={saveUpload}>
          {busy ? "Uploading" : "Upload document"}
        </button>
        {file && file.documents.length === 0 ? <p className="text-sm text-muted">No documents uploaded yet.</p> : null}
        <div className="space-y-2">
          {file?.documents.map((item) => (
            <div key={item.id} className="space-y-2 rounded-xl border border-line px-3 py-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.filename}</span>
                  <span className="text-xs text-muted">
                    {documentTypeLabel(item.category)}
                    {item.optimizedSize ? ` · ${formatBytes(item.optimizedSize)}` : ""}
                    {item.originalSize && item.optimizedSize && item.optimizedSize < item.originalSize ? ` · was ${formatBytes(item.originalSize)}` : ""}
                  </span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => openFile(item.storage_path)}>Open</button>
                  <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                    if (!window.confirm(`Delete ${item.filename}?`)) return;
                    void removeDocument(item.id)
                      .then(() => { onNotice?.("Document deleted."); load(); })
                      .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the document"));
                  }}>Delete</button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm">Type
                  <select
                    value={STUDENT_DOCUMENT_TYPES.some((row) => row.value === item.category) ? item.category : "other"}
                    onChange={(event) => {
                      void updateDocument(item.id, { category: event.target.value })
                        .then(() => { onNotice?.("Document type saved."); load(); })
                        .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the document"));
                    }}
                    className="mt-1 h-11 w-full rounded-md border border-line px-3"
                  >
                    {STUDENT_DOCUMENT_TYPES.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
                  </select>
                </label>
                <label className="text-sm">Status
                  <select
                    value={item.verification_status}
                    onChange={(event) => {
                      void updateDocument(item.id, { verificationStatus: event.target.value })
                        .then(() => { onNotice?.("Document status saved."); load(); })
                        .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the document"));
                    }}
                    className="mt-1 h-11 w-full rounded-md border border-line px-3 capitalize"
                  >
                    {["pending", "verified", "rejected"].map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Marks</h3>
        {file && file.marks.length === 0 ? <p className="text-sm text-muted">No marks recorded.</p> : null}
        {file?.marks.map((item) => (
          <p key={item.id} className="rounded-xl border border-line px-3 py-2 text-sm">{item.exam}{item.held_on ? ` · ${item.held_on}` : ""} · {item.score}</p>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Certificates</h3>
        {file && file.certificates.length === 0 ? <p className="text-sm text-muted">No certificates issued.</p> : null}
        {file?.certificates.map((item) => (
          <p key={item.id} className="rounded-xl border border-line px-3 py-2 text-sm">{item.certificate_number || "No number"} · {item.title} · {item.issued_on} · {item.status}</p>
        ))}
      </section>
    </div>
  );
}
