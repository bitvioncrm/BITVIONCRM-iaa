import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Portrait } from "@/components/shared/Portrait";
import { billParts, inr, invoiceTotal } from "@/lib/money";
import { addLedgerEntry, listLedger, removeLedgerEntry } from "@/services/clinic-care";
import { addToPatientBill, addToStudentBill, listClinicBills, listDeskPatients, listDeskStudents, loadPatientRecord, recordPayment, recordRefund, type ClinicBill, type DeskPatient, type DeskStudent } from "@/services/production-ops";
import type { WorkspaceOption } from "@/services/production-leads";

type ChargeKind = "Treatment" | "Booking" | "Product" | "Course fee" | "Registration" | "Material" | "Exam" | "Certificate";
type DraftLine = { kind: ChargeKind; description: string; quantity: string; price: string };
type PayMethod = "cash" | "upi" | "card";

const CLINIC_KINDS: ChargeKind[] = ["Treatment", "Booking", "Product"];
const INSTITUTE_KINDS: ChargeKind[] = ["Course fee", "Registration", "Material", "Exam", "Certificate"];
const CLINIC_EXPENSES = ["Rent", "Salary", "Supplies", "Utilities", "Maintenance", "Other"];
const INSTITUTE_EXPENSES = ["Rent", "Salary", "Materials", "Faculty", "Utilities", "Other"];

const emptyLine = (kind: ChargeKind): DraftLine => ({ kind, description: "", quantity: "1", price: "" });

export function BillingDesk({ workspace, mode = "clinic", onError, onNotice }: { workspace: WorkspaceOption; mode?: "clinic" | "institute"; onError: (value: string) => void; onNotice: (value: string) => void }) {
  const [params, setParams] = useSearchParams();
  const institute = mode === "institute";
  const kinds = institute ? INSTITUTE_KINDS : CLINIC_KINDS;
  const personKey = institute ? "student" : "patient";
  const [patients, setPatients] = useState<DeskPatient[]>([]);
  const [students, setStudents] = useState<DeskStudent[]>([]);
  const [bills, setBills] = useState<ClinicBill[]>([]);
  const [ledger, setLedger] = useState<Array<{ id: string; kind: "income" | "expense"; amount: number; note: string; patientName: string; createdAt: string }>>([]);
  const [selectedId, setSelectedId] = useState(params.get(personKey) || "");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(kinds[0])]);
  const [discount, setDiscount] = useState("0");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [collect, setCollect] = useState<Record<string, string>>({});
  const [ledgerPatient, setLedgerPatient] = useState("");
  const [ledgerAmount, setLedgerAmount] = useState("");
  const [ledgerNote, setLedgerNote] = useState("");
  const [expenseCategory, setExpenseCategory] = useState(institute ? INSTITUTE_EXPENSES[0] : CLINIC_EXPENSES[0]);
  const [expenseDetail, setExpenseDetail] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");

  const reload = () => {
    if (institute) void listDeskStudents(workspace.id).then(setStudents).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load students"));
    else void listDeskPatients(workspace.id).then(setPatients).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load patients"));
    void listClinicBills(workspace.id).then(setBills).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load bills"));
    void listLedger(workspace.id).then(setLedger).catch(() => setLedger([]));
  };

  useEffect(() => {
    reload();
  }, [workspace.id, mode]);

  useEffect(() => {
    const requested = params.get(personKey) || "";
    if (requested) setSelectedId(requested);
  }, [params, personKey]);

  const selectedStudent = students.find((item) => item.id === selectedId) ?? null;
  const selectedPatient = patients.find((item) => item.id === selectedId) ?? null;
  const selected = institute
    ? selectedStudent ? { id: selectedStudent.id, full_name: selectedStudent.full_name, code: selectedStudent.student_code, mobile: selectedStudent.mobile, photo_path: selectedStudent.photo_path, course: selectedStudent.course, admission: selectedStudent.admission_date || selectedStudent.created_at.slice(0, 10) } : null
    : selectedPatient ? { id: selectedPatient.id, full_name: selectedPatient.full_name, code: selectedPatient.patient_code, mobile: selectedPatient.mobile, photo_path: selectedPatient.photo_path, course: "", admission: "" } : null;
  const personBills = bills.filter((bill) => (institute ? bill.studentId === selectedId : bill.patientId === selectedId));
  const previousDue = personBills.filter((bill) => bill.status !== "cancelled" && bill.status !== "refunded").reduce((sum, bill) => sum + bill.balance, 0);
  const draftTotal = invoiceTotal(lines.map((line) => ({ quantity: Number(line.quantity) || 0, unitPrice: Number(line.price) || 0 })), Number(discount) || 0);
  const collected = bills.reduce((sum, bill) => sum + bill.paid, 0);
  const otherIncome = ledger.filter((row) => row.kind === "income").reduce((sum, row) => sum + row.amount, 0);
  const expenses = ledger.filter((row) => row.kind === "expense").reduce((sum, row) => sum + row.amount, 0);
  const people = useMemo(() => {
    const rows = institute
      ? students.map((student) => ({ id: student.id, full_name: student.full_name, code: student.student_code, photo_path: student.photo_path, detail: student.course || "No course" }))
      : patients.map((patient) => ({ id: patient.id, full_name: patient.full_name, code: patient.patient_code, photo_path: patient.photo_path, detail: "" }));
    return rows.sort((left, right) => left.full_name.localeCompare(right.full_name));
  }, [institute, patients, students]);
  const incomeRows = ledger.filter((row) => row.kind === "income");
  const expenseRows = ledger.filter((row) => row.kind === "expense");
  const expenseCategories = institute ? INSTITUTE_EXPENSES : CLINIC_EXPENSES;

  const fillFromVisits = () => {
    if (!selected) return;
    const already = new Set(personBills.flatMap((bill) => bill.items.map((item) => billParts(item.description).name.toLowerCase())));
    if (institute) {
      const next: DraftLine[] = [];
      if (selected.course && !already.has(selected.course.toLowerCase())) next.push({ kind: "Course fee", description: selected.course, quantity: "1", price: "" });
      setLines(next.length ? next : [emptyLine("Course fee")]);
      onNotice(next.length ? "The course fee is ready. Add registration, material, exam, or certificate if this scheme needs them." : "This course is already on the balance.");
      return;
    }
    if (!selectedPatient) return;
    setBusy(true);
    void loadPatientRecord(selectedPatient.id).then((record) => {
      const next: DraftLine[] = [];
      for (const visit of record.treatments) {
        if (visit.kind === "procedure" && visit.title && visit.title !== "Products" && !already.has(visit.title.toLowerCase())) {
          next.push({ kind: "Treatment", description: visit.title, quantity: "1", price: "" });
        }
        for (const product of visit.products) {
          if (already.has(product.name.toLowerCase())) continue;
          const unit = product.quantity > 0 ? Math.round(product.amount / product.quantity) : product.amount;
          next.push({ kind: "Product", description: product.name, quantity: String(product.quantity || 1), price: unit ? String(unit) : "" });
        }
      }
      for (const visit of selectedPatient.appointments) {
        if (visit.status === "cancelled" || visit.status === "no_show") continue;
        const name = visit.reason || "Appointment";
        if (already.has(name.toLowerCase())) continue;
        next.push({ kind: "Booking", description: name, quantity: "1", price: "" });
      }
      setLines(next.length ? next : [emptyLine("Treatment")]);
      onNotice(next.length ? "This visit is ready to add. Enter any missing price." : "Every named visit is already on the balance.");
    }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not read this person's visits")).finally(() => setBusy(false));
  };

  const choose = (id: string) => {
    setSelectedId(id);
    setLines([emptyLine(kinds[0])]);
    setDiscount("0");
    setPaid("");
    const next = new URLSearchParams(params);
    if (id) next.set(personKey, id);
    else next.delete(personKey);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Summary label="Collected on bills" value={inr(collected)} />
        <Summary label="Other income" value={inr(otherIncome)} />
        <Summary label="Additional expenses" value={inr(expenses)} />
        <Summary label="Balance" value={inr(collected + otherIncome - expenses)} />
      </div>

      <section className="rounded-2xl border border-[#eadfca] bg-[#faf6ee] p-3 sm:p-4">
        <h2 className="text-sm font-semibold">{institute ? "Students" : "People"}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => {
            const own = bills.filter((bill) => (institute ? bill.studentId === person.id : bill.patientId === person.id));
            const due = own.reduce((sum, bill) => sum + bill.balance, 0);
            const billed = own.reduce((sum, bill) => sum + bill.total, 0);
            return (
              <button key={person.id} type="button" onClick={() => choose(person.id)} className={`touch-card rounded-2xl border bg-white p-3 text-left ${selectedId === person.id ? "border-[#c6a15b]" : "border-line"}`}>
                <span className="flex items-center gap-3">
                  <Portrait name={person.full_name} path={person.photo_path} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{person.full_name}</span>
                    <span className="mt-1 block text-xs text-muted">{person.code}{person.detail ? ` · ${person.detail}` : ""} · {own.length ? `${own.length} bill${own.length === 1 ? "" : "s"}` : "No bill yet"}</span>
                  </span>
                </span>
                <span className="mt-3 block text-sm">Billed {inr(billed)} · Due {inr(due)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {selected ? (
        <section className="space-y-4 rounded-2xl border border-line bg-white p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-[#8a6a2f] uppercase">{selected.code}</p>
              <h2 className="text-xl font-semibold">{selected.full_name}</h2>
              <p className="text-sm text-muted">{selected.mobile || "No mobile"}{selected.course ? ` · ${selected.course}` : ""}</p>
            </div>
            <button type="button" disabled={busy} onClick={fillFromVisits} className="min-h-11 rounded-md border border-[#c6a15b] px-3 text-sm font-medium text-[#8a6a2f]">{institute ? "Add this course" : "Add this visit"}</button>
          </div>

          <VisitAccount title={institute ? "Schemes and balance" : "Visits and balance"} bills={personBills} treatments={institute ? (selected.course ? [{ id: `${selected.id}-course`, title: selected.course, performed_on: selected.admission }] : []) : (selectedPatient?.treatments ?? [])} collected={ledger.filter((row) => row.kind === "income" && row.patientName === selected.full_name).map((row) => ({ note: row.note, amount: row.amount }))} />

          {personBills.length === 0 ? null : personBills.map((bill) => (
            <article key={bill.id} className="rounded-2xl border border-[#eadfca] bg-[#faf6ee] p-3">
              <BillReceipt bill={bill} />
              {bill.balance > 0 ? (
                <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]" onSubmit={(event) => {
                  event.preventDefault();
                  const amount = Number(collect[bill.id] || 0);
                  if (amount <= 0) return;
                  setBusy(true);
                  void recordPayment({ organizationId: workspace.organizationId, workspaceId: workspace.id, invoiceId: bill.id, amount, method }).then(() => {
                    setCollect((current) => ({ ...current, [bill.id]: "" }));
                    onNotice("Payment saved on this bill.");
                    reload();
                  }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the payment")).finally(() => setBusy(false));
                }}>
                  <label className="text-sm">Receive now<input inputMode="decimal" value={collect[bill.id] ?? ""} onChange={(event) => setCollect((current) => ({ ...current, [bill.id]: event.target.value }))} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3" /></label>
                  <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:self-end">Save payment</button>
                  <button type="button" className="min-h-11 text-sm font-medium text-danger sm:self-end" onClick={() => {
                    const amount = Number(collect[bill.id] || bill.paid);
                    if (!amount || !window.confirm(`Refund ${inr(amount)} on ${bill.number}?`)) return;
                    void recordRefund({ organizationId: workspace.organizationId, workspaceId: workspace.id, invoiceId: bill.id, amount }).then(() => {
                      onNotice("Refund saved.");
                      reload();
                    }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the refund"));
                  }}>Refund</button>
                </form>
              ) : null}
            </article>
          ))}

          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            const payload = {
              organizationId: workspace.organizationId,
              workspaceId: workspace.id,
              discount: Number(discount) || 0,
              paid: Number(paid) || 0,
              method,
              lines: lines.map((line) => ({ kind: line.kind, description: line.description, quantity: Number(line.quantity) || 0, unitPrice: Number(line.price) || 0 })),
            };
            const saving = institute
              ? addToStudentBill({ ...payload, studentId: selected.id, lines: payload.lines.map((line) => ({ ...line, kind: line.kind as "Course fee" | "Registration" | "Material" | "Exam" | "Certificate" })) })
              : addToPatientBill({ ...payload, patientId: selected.id, lines: payload.lines.map((line) => ({ ...line, kind: line.kind as "Treatment" | "Booking" | "Product" })) });
            void saving.then((bill) => {
              setLines([emptyLine(kinds[0])]);
              setDiscount("0");
              setPaid("");
              onNotice(`${bill.number} saved. Total ${inr(bill.total)}.`);
              reload();
            }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the bill")).finally(() => setBusy(false));
          }}>
            <h3 className="text-sm font-semibold">{previousDue > 0 ? (institute ? "Add this scheme to the balance" : "Add this visit to the balance") : "New bill"}</h3>
            {previousDue > 0 ? <p className="text-sm text-muted">Previous balance {inr(previousDue)}. This charge is added on top, under its own name.</p> : null}
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-2xl border border-line p-3 sm:grid-cols-4">
                <label className="text-sm">Kind
                  <select value={line.kind} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as ChargeKind } : item))} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
                    {kinds.map((kind) => <option key={kind}>{kind}</option>)}
                  </select>
                </label>
                <label className="text-sm sm:col-span-1">{institute ? "Scheme name" : "Detail"}<input value={line.description} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Quantity<input inputMode="decimal" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                <label className="text-sm">Price<input inputMode="decimal" value={line.price} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
                {lines.length > 1 ? <button type="button" className="min-h-11 text-left text-sm font-medium text-danger" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove line</button> : null}
              </div>
            ))}
            <button type="button" className="min-h-11 text-sm font-medium text-navy" onClick={() => setLines((current) => [...current, emptyLine(kinds[0])])}>Add a line</button>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-sm">Discount<input inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Received now<input inputMode="decimal" value={paid} onChange={(event) => setPaid(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
              <label className="text-sm">Method
                <select value={method} onChange={(event) => setMethod(event.target.value as PayMethod)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">{institute ? "This scheme" : "This visit"} {inr(draftTotal)} · Balance {inr(previousDue + draftTotal)}</p>
              <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-4 text-sm text-white">{busy ? "Saving" : previousDue > 0 ? "Add to balance" : "Save bill"}</button>
            </div>
          </form>
        </section>
      ) : <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-muted">{institute ? "Choose a student to open their fee." : "Choose a person to open their bill."}</p>}

      <section className="space-y-3 rounded-2xl border border-line bg-white p-3 sm:p-4">
        <h2 className="text-sm font-semibold">Other income</h2>
        <p className="text-sm text-muted">{inr(otherIncome)} recorded apart from bills.</p>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void addLedgerEntry({
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
            patientId: institute ? null : ledgerPatient || null,
            kind: "income",
            amount: Number(ledgerAmount),
            note: ledgerNote,
          }).then(() => {
            setLedgerAmount("");
            setLedgerNote("");
            onNotice("Income saved.");
            reload();
          }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the income")).finally(() => setBusy(false));
        }}>
          {institute ? null : (
            <label className="text-sm sm:col-span-2">Person
              <select value={ledgerPatient} onChange={(event) => setLedgerPatient(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
                <option value="">No person</option>
                {people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm">Amount<input required inputMode="decimal" value={ledgerAmount} onChange={(event) => setLedgerAmount(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Note<input required value={ledgerNote} onChange={(event) => setLedgerNote(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:col-span-2">{busy ? "Saving" : "Save income"}</button>
        </form>
        {incomeRows.length === 0 ? <p className="text-sm text-muted">No other income yet.</p> : incomeRows.map((row) => (
          <div key={row.id} className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
            <p>Income · {inr(row.amount)} · {row.patientName || (institute ? "Institute" : "Clinic")} · {row.note}</p>
            <button type="button" className="min-h-11 shrink-0 text-sm font-medium text-danger" onClick={() => {
              if (!window.confirm("Delete this income?")) return;
              void removeLedgerEntry(row.id).then(() => { onNotice("Income deleted."); reload(); }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the income"));
            }}>Delete</button>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl border border-[#eadfca] bg-[#faf6ee] p-3 sm:p-4">
        <h2 className="text-sm font-semibold">Additional expenses</h2>
        <p className="text-sm text-muted">{institute ? "Institute" : "Clinic"} spending that is separate from a person's bill. Total {inr(expenses)}.</p>
        <form className="grid gap-2 rounded-2xl border border-[#eadfca] bg-white p-3 sm:grid-cols-3" onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          const note = expenseDetail.trim() ? `${expenseCategory} · ${expenseDetail.trim()}` : expenseCategory;
          void addLedgerEntry({
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
            patientId: null,
            kind: "expense",
            amount: Number(expenseAmount),
            note,
          }).then(() => {
            setExpenseAmount("");
            setExpenseDetail("");
            onNotice("Additional expense saved.");
            reload();
          }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the expense")).finally(() => setBusy(false));
        }}>
          <label className="text-sm">Expense
            <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
              {expenseCategories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-sm">Detail<input value={expenseDetail} onChange={(event) => setExpenseDetail(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Amount<input required inputMode="decimal" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <button type="submit" disabled={busy} className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:col-span-3">{busy ? "Saving" : "Add expense"}</button>
        </form>
        {expenseRows.length === 0 ? <p className="text-sm text-muted">No additional expenses yet.</p> : expenseRows.map((row) => (
          <div key={row.id} className="flex items-start justify-between gap-3 rounded-xl border border-[#eadfca] bg-white px-3 py-2 text-sm">
            <p>Expense · {inr(row.amount)} · {row.note}</p>
            <button type="button" className="min-h-11 shrink-0 text-sm font-medium text-danger" onClick={() => {
              if (!window.confirm("Delete this expense?")) return;
              void removeLedgerEntry(row.id).then(() => { onNotice("Expense deleted."); reload(); }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the expense"));
            }}>Delete</button>
          </div>
        ))}
      </section>
    </div>
  );
}

export function VisitAccount({ bills, treatments, collected = [], title = "Visits and balance" }: { bills: ClinicBill[]; treatments: Array<{ id: string; title: string; performed_on: string }>; collected?: Array<{ note: string; amount: number }>; title?: string }) {
  const openBills = bills.filter((bill) => bill.status !== "cancelled" && bill.status !== "refunded");
  const rows: Array<{ key: string; name: string; at: string; amount: number | null }> = [];
  const billed = new Set<string>();
  for (const bill of [...openBills].sort((left, right) => left.issuedOn.localeCompare(right.issuedOn))) {
    bill.items.forEach((item, index) => {
      const name = billParts(item.description).name;
      billed.add(name.toLowerCase());
      rows.push({ key: `${bill.id}-${index}`, name, at: bill.issuedOn, amount: item.amount });
    });
  }
  for (const visit of treatments) {
    if (!visit.title || billed.has(visit.title.toLowerCase())) continue;
    rows.push({ key: visit.id, name: visit.title, at: visit.performed_on.slice(0, 10), amount: null });
  }
  rows.sort((left, right) => left.at.localeCompare(right.at));
  const billPaid = openBills.reduce((sum, bill) => sum + bill.paid, 0);
  let carried = 0;
  if (billPaid === 0) {
    const notes = collected.filter((item) => item.amount > 0 && item.note.trim());
    for (const row of rows) {
      if (row.amount != null) continue;
      const index = notes.findIndex((item) => {
        const note = item.note.toLowerCase();
        const name = row.name.toLowerCase();
        return name.includes(note) || note.includes(name);
      });
      if (index < 0) continue;
      row.amount = notes[index].amount;
      carried += notes[index].amount;
      notes.splice(index, 1);
    }
  }
  let running = 0;
  const paid = billPaid + carried;
  if (!rows.length) return <p className="text-sm text-muted">Nothing on this account yet.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-[#eadfca]">
      <p className="bg-[#faf6ee] px-3 py-2 text-xs font-semibold tracking-wide text-[#8a6a2f] uppercase">{title}</p>
      {rows.map((row) => {
        if (row.amount != null) running += row.amount;
        return (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-[#eadfca] bg-white px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              <p className="text-xs text-muted">{row.at}</p>
            </div>
            <p className="sm:text-right">{row.amount == null ? "Not billed" : inr(row.amount)}</p>
            <p className="col-span-2 font-medium sm:col-span-1 sm:text-right">Balance {inr(running)}</p>
          </div>
        );
      })}
      <p className="border-t border-[#eadfca] bg-[#faf6ee] px-3 py-2 text-sm">Received {inr(paid)} · Balance due {inr(Math.max(0, running - paid))}</p>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-line bg-white px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </article>
  );
}

export function BillReceipt({ bill }: { bill: { number: string; issuedOn: string; status: string; discount: number; total: number; paid: number; balance: number; items: Array<{ description: string; quantity: number; amount: number }> } }) {
  const groups = ["Treatment", "Booking", "Product", "Course fee", "Registration", "Material", "Exam", "Certificate", "Charge"];
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{bill.number || "Bill"}</p>
          <p className="text-xs text-muted">{bill.issuedOn}</p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium capitalize text-[#8a6a2f]">{bill.status.replaceAll("_", " ")}</span>
      </div>
      {groups.map((kind) => {
        const rows = bill.items.filter((item) => billParts(item.description).kind === kind);
        if (!rows.length) return null;
        const sum = rows.reduce((total, item) => total + item.amount, 0);
        return (
          <div key={kind} className="mt-3">
            <p className="text-xs font-semibold tracking-wide text-[#8a6a2f] uppercase">{kind} · {inr(sum)}</p>
            {rows.map((item, index) => (
              <p key={`${kind}-${index}`} className="mt-1 text-sm">{billParts(item.description).name} × {item.quantity} · {inr(item.amount)}</p>
            ))}
          </div>
        );
      })}
      <p className="mt-3 text-sm">Discount {inr(bill.discount)} · Total {inr(bill.total)} · Paid {inr(bill.paid)} · Balance {inr(bill.balance)}</p>
    </div>
  );
}
