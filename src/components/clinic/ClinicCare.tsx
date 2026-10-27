import { useEffect, useState } from "react";
import type { WorkspaceOption } from "@/services/production-leads";
import { listCareProducts, listPatientCare, recordPatientCare, updatePatientDetails, type CareVisit } from "@/services/clinic-care";

interface PatientRow {
  id: string;
  full_name: string;
  mobile: string;
  notes?: string;
}

export function ClinicCare({
  workspace,
  patients,
  doctors,
  onSaved,
  onError,
}: {
  workspace: WorkspaceOption;
  patients: PatientRow[];
  doctors: Array<{ userId: string; name: string }>;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [procedure1, setProcedure1] = useState("");
  const [procedure2, setProcedure2] = useState("");
  const [performedOn, setPerformedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [lines, setLines] = useState<Array<{ productId: string; name: string; quantity: number }>>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; stock: number; price: number }>>([]);
  const [visits, setVisits] = useState<CareVisit[]>([]);
  const [editName, setEditName] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    void listCareProducts(workspace.id).then(setProducts).catch(() => setProducts([]));
    void listPatientCare(workspace.id).then(setVisits).catch(() => setVisits([]));
  };

  useEffect(() => {
    load();
    const onLive = () => load();
    window.addEventListener("bitvion-stock", onLive);
    window.addEventListener("bitvion-care", onLive);
    return () => {
      window.removeEventListener("bitvion-stock", onLive);
      window.removeEventListener("bitvion-care", onLive);
    };
  }, [workspace.id]);

  const patient = patients.find((item) => item.id === patientId);

  useEffect(() => {
    setEditName(patient?.full_name ?? "");
    setEditMobile(patient?.mobile ?? "");
  }, [patient?.full_name, patient?.id, patient?.mobile]);

  return (
    <section className="space-y-4 rounded-lg border border-line bg-white p-4 lg:col-span-2">
      <div>
        <h2 className="font-semibold">Treatment and products</h2>
        <p className="text-sm text-muted">Saving products reduces the clinic stock at once and adds the amount to reception income.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <select className="rounded-md border border-line px-2 py-2" value={patientId} onChange={(event) => setPatientId(event.target.value)}>
          <option value="">Patient</option>
          {patients.map((item) => <option key={item.id} value={item.id}>{item.full_name} · {item.mobile}</option>)}
        </select>
        <select className="rounded-md border border-line px-2 py-2" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
          <option value="">Doctor who did the procedure</option>
          {doctors.map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
        </select>
        <input className="rounded-md border border-line px-2 py-2" placeholder="Procedure 1" value={procedure1} onChange={(event) => setProcedure1(event.target.value)} />
        <input className="rounded-md border border-line px-2 py-2" placeholder="Procedure 2" value={procedure2} onChange={(event) => setProcedure2(event.target.value)} />
        <input className="rounded-md border border-line px-2 py-2" type="date" value={performedOn} onChange={(event) => setPerformedOn(event.target.value)} />
        <input className="rounded-md border border-line px-2 py-2" placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="min-w-56 flex-1 rounded-md border border-line px-2 py-2" value={productId} onChange={(event) => setProductId(event.target.value)}>
          <option value="">Product used</option>
          {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stock} in stock · ₹{item.price}</option>)}
        </select>
        <input className="w-24 rounded-md border border-line px-2 py-2" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <button
          className="rounded-md border border-line px-3 py-2 text-sm"
          type="button"
          onClick={() => {
            const product = products.find((item) => item.id === productId);
            const count = Number(quantity);
            if (!product || count <= 0) return;
            setLines((current) => [...current, { productId: product.id, name: product.name, quantity: count }]);
          }}
        >
          Add product
        </button>
      </div>
      {lines.length ? <ul className="text-sm">{lines.map((line, index) => <li key={`${line.productId}:${index}`}>{line.name} × {line.quantity}</li>)}</ul> : null}
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-60"
          type="button"
          disabled={busy || !patientId}
          onClick={() => {
            setBusy(true);
            void recordPatientCare({
              patientId,
              doctorId: doctorId || null,
              procedure1,
              procedure2,
              performedOn,
              notes,
              items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
            })
              .then(() => {
                setLines([]);
                setProcedure1("");
                setProcedure2("");
                setNotes("");
                onSaved("Treatment saved. Stock and reception income are updated.");
                load();
              })
              .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the treatment"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : "Save treatment"}
        </button>
        {patient ? (
          <button
            className="rounded-md border border-line px-3 py-2 text-sm"
            type="button"
            onClick={() => {
              void updatePatientDetails({ id: patient.id, fullName: editName, mobile: editMobile, notes: patient.notes ?? "" })
                .then(() => onSaved("Patient details updated."))
                .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the patient"));
            }}
          >
            Save patient details
          </button>
        ) : null}
      </div>
      {patient ? (
        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded-md border border-line px-2 py-2" value={editName} onChange={(event) => setEditName(event.target.value)} />
          <input className="rounded-md border border-line px-2 py-2" value={editMobile} onChange={(event) => setEditMobile(event.target.value)} placeholder="Mobile" />
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Recent treatments</h3>
        {visits.length === 0 ? <p className="text-sm text-muted">No treatments recorded yet.</p> : visits.map((visit) => (
          <article key={visit.id} className="rounded-md border border-line p-3 text-sm">
            <p className="font-medium">{visit.patientName} · {visit.performedOn}</p>
            <p className="text-muted">{visit.doctorName} · {visit.procedure1 || "Procedure 1 not set"}{visit.procedure2 ? ` · ${visit.procedure2}` : ""}</p>
            {visit.items.length ? <p>{visit.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")} · ₹{visit.productTotal.toLocaleString("en-IN")}</p> : <p className="text-muted">No products on this visit.</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
