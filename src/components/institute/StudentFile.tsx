import { useEffect, useState } from "react";
import { listStudentFile, signedDocumentUrl, uploadPrivateFile } from "@/services/production-ops";

type FileRow = Awaited<ReturnType<typeof listStudentFile>>;

export function StudentFile({ organizationId, workspaceId, studentId, onError, onNotice }: {
  organizationId: string;
  workspaceId: string;
  studentId: string;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  const [file, setFile] = useState<FileRow | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    void listStudentFile(workspaceId, studentId).then(setFile).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load the student file"));
  };
  useEffect(() => {
    void listStudentFile(workspaceId, studentId).then(setFile).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load the student file"));
  }, [onError, studentId, workspaceId]);
  const openFile = (path: string) => {
    void signedDocumentUrl(path).then((url) => window.open(url, "_blank", "noopener")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not open the file"));
  };
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Uploaded documents</h3>
          <label className={`cursor-pointer rounded-full border border-line px-3 py-1.5 text-sm ${busy ? "opacity-60" : ""}`}>
            {busy ? "Uploading" : "Upload"}
            <input type="file" className="hidden" disabled={busy} onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (!chosen) return;
              setBusy(true);
              void uploadPrivateFile({ organizationId, workspaceId, entityType: "student", entityId: studentId, file: chosen, category: "academic" })
                .then(() => { onNotice?.("Document saved on this student."); load(); })
                .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not upload the document"))
                .finally(() => setBusy(false));
            }} />
          </label>
        </div>
        {file && file.documents.length === 0 ? <p className="text-sm text-muted">No documents uploaded yet.</p> : null}
        {file?.documents.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.filename}</span>
              <span className="text-xs text-muted capitalize">{item.category || "document"} · {item.verification_status}</span>
            </span>
            <button type="button" className="rounded-md border border-line px-2 py-1 text-xs" onClick={() => openFile(item.storage_path)}>Open</button>
          </div>
        ))}
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
