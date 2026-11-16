import { useEffect, useId, useMemo, useRef, useState } from "react";

export type PatientOption = {
  id: string;
  full_name: string;
  patient_code?: string;
  mobile?: string;
  place?: string;
};

function matches(patient: PatientOption, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return `${patient.full_name} ${patient.patient_code || ""} ${patient.mobile || ""} ${patient.place || ""}`.toLowerCase().includes(term);
}

function label(patient: PatientOption) {
  const parts = [patient.full_name];
  if (patient.patient_code) parts.push(patient.patient_code);
  if (patient.mobile) parts.push(patient.mobile);
  return parts.join(" · ");
}

export function PatientSearchSelect({
  patients,
  value,
  onChange,
  disabled = false,
  required = false,
  placeholder = "Search name, mobile, or code…",
  emptyLabel = "Choose a patient",
  className = "",
}: {
  patients: PatientOption[];
  value: string;
  onChange: (patientId: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = patients.find((item) => item.id === value) ?? null;
  const filtered = useMemo(() => {
    const rows = patients.filter((item) => matches(item, query));
    return rows.slice(0, 100);
  }, [patients, query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const pick = (patient: PatientOption | null) => {
    onChange(patient?.id ?? "");
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {required ? <input required value={value} onChange={() => undefined} className="sr-only" tabIndex={-1} aria-hidden /> : null}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded-md border border-line bg-white px-3 text-left text-sm disabled:opacity-60"
      >
        <span className={`min-w-0 truncate ${chosen ? "text-ink" : "text-muted"}`}>
          {chosen ? label(chosen) : emptyLabel}
        </span>
        <span className="shrink-0 text-muted" aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-[60] mt-1 overflow-hidden rounded-md border border-line bg-white shadow-pop">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="h-10 w-full rounded-md border border-line px-3 text-sm"
              aria-label="Search patients"
              autoComplete="off"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className="flex w-full px-3 py-2 text-left text-sm text-muted hover:bg-[#f7f4ee]"
                onClick={() => pick(null)}
              >
                {emptyLabel}
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted">No patient matches “{query.trim()}”.</li>
            ) : filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-[#f7f4ee] ${item.id === value ? "bg-[#f7f4ee]" : ""}`}
                  onClick={() => pick(item)}
                >
                  <span className="font-medium text-ink">{item.full_name}</span>
                  <span className="text-xs text-muted">
                    {[item.patient_code, item.mobile, item.place].filter(Boolean).join(" · ") || "Patient file"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {patients.length > filtered.length && query.trim() ? (
            <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Showing top {filtered.length} matches. Type more to narrow.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
