import { useEffect, useState, type FormEvent } from "react";
import { BusinessBoard } from "@/components/dashboard/BusinessBoard";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp } from "@/lib/production-access";
import { listDoctors, listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { inr } from "@/lib/money";
import { changeStock, createAppointment, createCourse, createExam, createInvoice, createPatient, createProduct, createStudent, issueCertificate, listAppointments, listCertificates, listDocuments, listExams, listPatients, listProducts, listStockMoves, listStudents, recordMark, recordPayment, recordRefund, removeProduct, saveConsultation, seedClinicSkincareStock, setDocumentStatus, signedDocumentUrl, updateAppointmentStatus, updateProductPricing, uploadPrivateFile, type InventoryProduct } from "@/services/production-ops";

export function ProductionModule({ module }: { module: "clinic" | "institute" | "inventory" | "billing" }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const workspace = workspaces.find((item) => item.id === workspaceId);

  useEffect(() => {
    void listWorkspaces().then((rows) => {
      const visible = module === "clinic" || module === "institute"
        ? rows.filter((item) => item.workspaceType === module)
        : module === "inventory"
          ? rows.filter((item) => item.workspaceType === "clinic")
          : rows;
      setWorkspaces(visible);
      setWorkspaceId((current) => visible.some((item) => item.id === current) ? current : visible[0]?.id || "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, [module]);

  const admin = canOperateWhatsApp(useAuth().productionUser?.roleKey ?? "");
  const showBoard = admin && (module === "clinic" || module === "institute");
  return (
    <div className="space-y-4">
      {showBoard ? <BusinessBoard desk={module} variant="operations" /> : <h1 className="text-2xl font-semibold capitalize">{module}</h1>}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm">{notice}</p> : null}
      <select className="rounded-md border border-line px-2 py-2" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
        {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {!workspace ? <p className="text-sm text-muted">This desk is not available.</p> : null}
      {workspace && module === "clinic" ? <ClinicPanel workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
      {workspace && module === "institute" ? <InstitutePanel workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
      {workspace && module === "inventory" ? <InventoryPanel workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
      {workspace && module === "billing" ? <BillingPanel workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
    </div>
  );
}

function ClinicPanel({ workspace, onError, onNotice }: PanelProps) {
  const { productionUser } = useAuth();
  const key = productionUser?.roleKey ?? "admin";
  const doctor = key === "doctor";
  const reception = key === "receptionist";
  const [patients, setPatients] = useState<Array<{ id: string; patient_code: string; full_name: string; mobile: string }>>([]);
  const [appointments, setAppointments] = useState<Array<{ id: string; starts_at: string; status: string; reason: string }>>([]);
  const [patientId, setPatientId] = useState("");
  const [doctors, setDoctors] = useState<Array<{ userId: string; name: string }>>([]);
  const [query, setQuery] = useState("");
  const reloadPatients = (search = query) => void listPatients(workspace.id, search).then((rows) => setPatients(rows as typeof patients)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load patients"));
  useEffect(() => {
    void listPatients(workspace.id, "").then((rows) => setPatients(rows as typeof patients)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load patients"));
    void listAppointments(workspace.id).then((rows) => setAppointments(rows as typeof appointments)).catch(() => setAppointments([]));
    void listDoctors(workspace.id).then(setDoctors).catch(() => setDoctors([]));
  }, [onError, workspace.id]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 rounded-lg border border-line bg-white p-4">
        <h2 className="font-semibold">{doctor ? "Patients" : "Register patient"}</h2>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); reloadPatients(query); }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search patients" className="w-full rounded-md border border-line px-2 py-2" />
          <button className="rounded-md border border-line px-3 py-2 text-sm" type="submit">Search</button>
        </form>
        {doctor ? null : (
          <form className="space-y-2" onSubmit={(event) => submit(event, async (data) => {
            const code = await createPatient({
              organizationId: workspace.organizationId,
              workspaceId: workspace.id,
              fullName: data.get("name") as string,
              mobile: data.get("mobile") as string,
              place: data.get("place") as string,
              email: data.get("email") as string,
              gender: data.get("gender") as string,
              dateOfBirth: (data.get("dob") as string) || null,
              address: data.get("address") as string,
              emergencyContact: data.get("emergency") as string,
              notes: data.get("notes") as string,
            });
            onNotice(`Patient ${code} saved.`);
            reloadPatients("");
          }, onError)}>
            <input name="name" required placeholder="Full name" className="w-full rounded-md border border-line px-2 py-2" />
            <input name="dob" type="date" className="w-full rounded-md border border-line px-2 py-2" />
            <select name="gender" className="w-full rounded-md border border-line px-2 py-2"><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select>
            <input name="mobile" required placeholder="Mobile" className="w-full rounded-md border border-line px-2 py-2" />
            <input name="email" type="email" placeholder="Email" className="w-full rounded-md border border-line px-2 py-2" />
            <input name="address" placeholder="Address" className="w-full rounded-md border border-line px-2 py-2" />
            <input name="place" placeholder="Place" className="w-full rounded-md border border-line px-2 py-2" />
            <input name="emergency" placeholder="Emergency contact" className="w-full rounded-md border border-line px-2 py-2" />
            <input name="notes" placeholder="Notes" className="w-full rounded-md border border-line px-2 py-2" />
            <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Save</button>
          </form>
        )}
        {patients.length === 0 ? <p className="text-sm text-muted">No patients yet.</p> : patients.map((patient) => <p key={patient.id} className="text-sm">{patient.patient_code} · {patient.full_name} · {patient.mobile}</p>)}
      </div>
      <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
        await createAppointment({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          patientId: data.get("patient") as string,
          doctorId: (data.get("doctor") as string) || null,
          startsAt: new Date(data.get("when") as string).toISOString(),
          reason: data.get("reason") as string,
          status: data.get("walkin") === "on" ? "arrived" : "scheduled",
        });
        onNotice("Appointment saved.");
        const rows = await listAppointments(workspace.id);
        setAppointments(rows as typeof appointments);
      }, onError)}>
        <h2 className="font-semibold">{doctor ? "Today's queue" : "Appointments"}</h2>
        {doctor ? null : (
          <>
            <select name="patient" className="w-full rounded-md border border-line px-2 py-2" value={patientId} onChange={(event) => setPatientId(event.target.value)}>
              <option value="">Patient</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name}</option>)}
            </select>
            <select name="doctor" className="w-full rounded-md border border-line px-2 py-2">
              <option value="">Doctor</option>
              {doctors.map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm"><input name="walkin" type="checkbox" /> Walk-in, mark arrived</label>
            <input name="when" type="datetime-local" required className="w-full rounded-md border border-line px-2 py-2" />
            <input name="reason" placeholder="Reason" className="w-full rounded-md border border-line px-2 py-2" />
            <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Book</button>
          </>
        )}
        {appointments.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{item.starts_at} · {item.status} · {item.reason}</span>
            <select value={item.status} onChange={(event) => {
              void updateAppointmentStatus(item.id, event.target.value).then(async () => setAppointments(await listAppointments(workspace.id) as typeof appointments)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the appointment"));
            }}>
              {(doctor ? ["arrived", "in_consultation", "completed", "no_show"] : ["scheduled", "confirmed", "arrived", "cancelled", "no_show"]).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        ))}
      </form>
      {reception ? null : (
        <form className="space-y-2 rounded-lg border border-line bg-white p-4 lg:col-span-2" onSubmit={(event) => submit(event, async (data) => {
          await saveConsultation({
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
            patientId: data.get("patient") as string,
            diagnosis: data.get("diagnosis") as string,
            plan: data.get("plan") as string,
            medicine: data.get("medicine") as string,
            dosage: data.get("dosage") as string,
            followUpOn: (data.get("follow") as string) || null,
          });
          onNotice("Consultation saved.");
        }, onError)}>
          <h2 className="font-semibold">Consultation, diagnosis, and prescription</h2>
          <select name="patient" className="w-full rounded-md border border-line px-2 py-2">{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name}</option>)}</select>
          <input name="diagnosis" placeholder="Diagnosis" className="w-full rounded-md border border-line px-2 py-2" />
          <input name="plan" placeholder="Treatment plan and notes" className="w-full rounded-md border border-line px-2 py-2" />
          <input name="medicine" placeholder="Prescription" className="w-full rounded-md border border-line px-2 py-2" />
          <input name="dosage" placeholder="Dosage" className="w-full rounded-md border border-line px-2 py-2" />
          <input name="follow" type="date" className="w-full rounded-md border border-line px-2 py-2" />
          <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Save consultation</button>
        </form>
      )}
    </div>
  );
}

function InstitutePanel({ workspace, onError, onNotice }: PanelProps) {
  const [students, setStudents] = useState<Array<{ id: string; student_code: string; full_name: string; status: string }>>([]);
  const load = () => void listStudents(workspace.id).then((rows) => setStudents(rows as typeof students)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load students"));
  useEffect(() => {
    void listStudents(workspace.id).then((rows) => setStudents(rows as typeof students)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load students"));
  }, [onError, workspace.id]);
  return (
    <div className="space-y-4">
    <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
      const courseId = await createCourse({ organizationId: workspace.organizationId, workspaceId: workspace.id, name: data.get("course") as string });
      const code = await createStudent({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        fullName: data.get("name") as string,
        mobile: data.get("mobile") as string,
        courseId,
        batchName: data.get("batch") as string,
        admissionDate: (data.get("admitted") as string) || null,
        status: data.get("status") as string,
      });
      onNotice(`Student ${code} admitted.`);
      load();
    }, onError)}>
      <h2 className="font-semibold">Admit student</h2>
      <input name="name" required placeholder="Student name" className="w-full rounded-md border border-line px-2 py-2" />
      <input name="mobile" placeholder="Mobile" className="w-full rounded-md border border-line px-2 py-2" />
      <input name="course" required placeholder="Course" className="w-full rounded-md border border-line px-2 py-2" />
      <input name="batch" placeholder="Batch" className="w-full rounded-md border border-line px-2 py-2" />
      <input name="admitted" type="date" className="w-full rounded-md border border-line px-2 py-2" />
      <select name="status" className="w-full rounded-md border border-line px-2 py-2"><option value="enquiry">Enquiry</option><option value="admitted">Admitted</option><option value="active">Active</option><option value="completed">Completed</option></select>
      <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Admit</button>
      {students.length === 0 ? <p className="text-sm text-muted">No students yet.</p> : students.map((student) => <p key={student.id} className="text-sm">{student.student_code} · {student.full_name} · {student.status}</p>)}
    </form>
    <AcademicPanel workspace={workspace} students={students} onError={onError} onNotice={onNotice} />
    </div>
  );
}

function AcademicPanel({ workspace, students, onError, onNotice }: PanelProps & { students: Array<{ id: string; full_name: string }> }) {
  const [exams, setExams] = useState<Array<{ id: string; name: string }>>([]);
  const [certificates, setCertificates] = useState<Array<{ id: string; title: string; certificate_number: string; issued_on: string; status: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; filename: string; verification_status: string; storage_path: string }>>([]);
  const [documentStudent, setDocumentStudent] = useState("");
  const activeStudent = documentStudent || students[0]?.id || "";
  useEffect(() => {
    void listExams(workspace.id).then((rows) => setExams(rows as typeof exams)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load exams"));
    void listCertificates(workspace.id).then((rows) => setCertificates(rows as typeof certificates)).catch(() => setCertificates([]));
  }, [onError, workspace.id]);
  useEffect(() => {
    if (!activeStudent) return;
    void listDocuments(workspace.id, activeStudent).then((rows) => setDocuments(rows as typeof documents)).catch(() => setDocuments([]));
  }, [activeStudent, workspace.id]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
        const file = data.get("file");
        if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file");
        await uploadPrivateFile({ organizationId: workspace.organizationId, workspaceId: workspace.id, entityType: "student", entityId: data.get("student") as string, file, category: "academic" });
        onNotice("Document stored in the private bucket. PDF and Office files are kept as uploaded.");
        const studentId = data.get("student") as string;
        setDocumentStudent(studentId);
        setDocuments(await listDocuments(workspace.id, studentId) as typeof documents);
      }, onError)}>
        <h2 className="font-semibold">Student document</h2>
        <select name="student" className="w-full rounded-md border border-line px-2 py-2" value={activeStudent} onChange={(event) => setDocumentStudent(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>
        <input name="file" type="file" required className="w-full text-sm" />
        <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Upload</button>
        {documents.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{item.filename} · {item.verification_status}</span>
            <button type="button" className="rounded-md border border-line px-2 py-1" onClick={() => void signedDocumentUrl(item.storage_path).then((url) => window.open(url, "_blank", "noopener")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not open the file"))}>Download</button>
            <select value={item.verification_status} onChange={(event) => void setDocumentStatus(item.id, event.target.value).then(() => listDocuments(workspace.id, activeStudent)).then((rows) => setDocuments(rows as typeof documents)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the document"))}>
              {["pending", "verified", "rejected"].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        ))}
      </form>
      <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
        await createExam({ organizationId: workspace.organizationId, workspaceId: workspace.id, name: data.get("exam") as string, heldOn: (data.get("held") as string) || null });
        setExams(await listExams(workspace.id) as typeof exams);
        onNotice("Exam saved.");
      }, onError)}>
        <h2 className="font-semibold">Exam</h2>
        <input name="exam" required placeholder="Exam name" className="w-full rounded-md border border-line px-2 py-2" />
        <input name="held" type="date" className="w-full rounded-md border border-line px-2 py-2" />
        <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Save exam</button>
        {exams.map((exam) => <p key={exam.id} className="text-sm">{exam.name}</p>)}
      </form>
      <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
        await recordMark({ examId: data.get("exam") as string, studentId: data.get("student") as string, score: Number(data.get("score")) });
        onNotice("Marks saved.");
      }, onError)}>
        <h2 className="font-semibold">Marks</h2>
        <select name="exam" className="w-full rounded-md border border-line px-2 py-2">{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}</select>
        <select name="student" className="w-full rounded-md border border-line px-2 py-2">{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>
        <input name="score" type="number" required placeholder="Score" className="w-full rounded-md border border-line px-2 py-2" />
        <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Save marks</button>
      </form>
      <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
        await issueCertificate({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          studentId: data.get("student") as string,
          title: data.get("title") as string,
          number: data.get("number") as string,
          issuedOn: (data.get("issued") as string) || null,
          status: "issued",
        });
        setCertificates(await listCertificates(workspace.id) as typeof certificates);
        onNotice("Certificate recorded as issued.");
      }, onError)}>
        <h2 className="font-semibold">Certificate</h2>
        <select name="student" className="w-full rounded-md border border-line px-2 py-2">{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>
        <input name="title" required placeholder="Certificate title" className="w-full rounded-md border border-line px-2 py-2" />
        <input name="number" placeholder="Certificate number" className="w-full rounded-md border border-line px-2 py-2" />
        <input name="issued" type="date" className="w-full rounded-md border border-line px-2 py-2" />
        <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Mark issued</button>
        {certificates.map((item) => <p key={item.id} className="text-sm">{item.certificate_number || "No number"} · {item.title} · {item.issued_on} · {item.status}</p>)}
      </form>
    </div>
  );
}

const INVENTORY_CATEGORIES = ["Face wash", "Moisturizer", "Sunscreen", "Other"];

function InventoryPanel({ workspace, onError, onNotice }: PanelProps) {
  const { productionUser } = useAuth();
  const admin = canOperateWhatsApp(productionUser?.roleKey ?? "");
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [moves, setMoves] = useState<Array<{ id: string; product_id: string; transaction_type: string; quantity: number; note: string; created_at: string }>>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [busyId, setBusyId] = useState("");
  const [seeding, setSeeding] = useState(false);

  const load = () => {
    void listProducts(workspace.id).then(setProducts).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load stock"));
    void listStockMoves(workspace.id).then((rows) => setMoves(rows as typeof moves)).catch(() => setMoves([]));
  };

  useEffect(() => {
    void listProducts(workspace.id).then(setProducts).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load stock"));
    void listStockMoves(workspace.id).then((rows) => setMoves(rows as typeof moves)).catch(() => setMoves([]));
  }, [onError, workspace.id]);

  const visible = categoryFilter === "all" ? products : products.filter((item) => item.category === categoryFilter);
  const byCategory = INVENTORY_CATEGORIES.map((category) => ({
    category,
    count: products.filter((item) => item.category === category).length,
    units: products.filter((item) => item.category === category).reduce((sum, item) => sum + Number(item.current_stock), 0),
  })).filter((item) => item.count > 0 || item.category !== "Other");
  const totalUnits = products.reduce((sum, item) => sum + Number(item.current_stock), 0);
  const productName = (id: string) => products.find((item) => item.id === id)?.name ?? "Product";

  const adjust = (productId: string, kind: "purchase" | "adjustment" | "treatment", quantity: number, note: string) => {
    if (!quantity || quantity < 1) {
      onError("Enter how many units to change.");
      return;
    }
    setBusyId(productId);
    void changeStock(productId, kind, quantity, note)
      .then(load)
      .then(() => onNotice("Stock updated."))
      .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Stock change failed"))
      .finally(() => setBusyId(""));
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Clinic inventory</h2>
          </div>
          {admin ? (
            <button
              type="button"
              disabled={seeding}
              className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:border-accent"
              onClick={() => {
                setSeeding(true);
                void seedClinicSkincareStock()
                  .then((count) => {
                    onNotice(count > 0 ? `${count} products loaded from the clinic stock sheet.` : "Those products are already in inventory.");
                    load();
                  })
                  .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load the stock sheet"))
                  .finally(() => setSeeding(false));
              }}
            >
              {seeding ? "Loading sheet…" : "Load sheet stock"}
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-line px-3 py-2">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Products</p>
            <p className="mt-1 text-2xl font-semibold tabular">{products.length}</p>
          </div>
          <div className="rounded-md border border-line px-3 py-2">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Total units</p>
            <p className="mt-1 text-2xl font-semibold tabular">{totalUnits}</p>
          </div>
          {byCategory.slice(0, 2).map((item) => (
            <div key={item.category} className="rounded-md border border-line px-3 py-2">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{item.category}</p>
              <p className="mt-1 text-2xl font-semibold tabular">{item.units}</p>
              <p className="text-xs text-muted">{item.count} products</p>
            </div>
          ))}
        </div>
      </section>

      {admin ? (
        <form className="space-y-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
          await createProduct({
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
            name: data.get("name") as string,
            stock: Number(data.get("stock") || 0),
            minimum: Number(data.get("minimum") || 5),
            category: data.get("category") as string,
            purchasePrice: Number(data.get("purchase") || 0),
            sellingPrice: Number(data.get("selling") || 0),
            supplier: data.get("supplier") as string,
          });
          (event.target as HTMLFormElement).reset();
          onNotice("Product saved with opening stock and price.");
          load();
        }, onError)}>
          <h2 className="font-semibold">Add product</h2>
          <div className="grid gap-2 md:grid-cols-2">
            <input name="name" required placeholder="Product name" className="rounded-md border border-line px-2 py-2" />
            <select name="category" defaultValue="Face wash" className="rounded-md border border-line px-2 py-2">
              {INVENTORY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <input name="stock" type="number" min={0} defaultValue={0} placeholder="Opening stock" className="rounded-md border border-line px-2 py-2" />
            <input name="minimum" type="number" min={0} defaultValue={5} placeholder="Low-stock alert" className="rounded-md border border-line px-2 py-2" />
            <input name="selling" type="number" min={0} step="0.01" defaultValue={0} placeholder="Selling price ₹" className="rounded-md border border-line px-2 py-2" />
            <input name="purchase" type="number" min={0} step="0.01" defaultValue={0} placeholder="Purchase price ₹" className="rounded-md border border-line px-2 py-2" />
            <input name="supplier" placeholder="Supplier" className="rounded-md border border-line px-2 py-2 md:col-span-2" />
          </div>
          <button className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">Save product</button>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={`rounded-md border px-3 py-1.5 text-sm ${categoryFilter === "all" ? "border-accent text-accent" : "border-line"}`} onClick={() => setCategoryFilter("all")}>All</button>
        {INVENTORY_CATEGORIES.map((category) => (
          <button key={category} type="button" className={`rounded-md border px-3 py-1.5 text-sm ${categoryFilter === category ? "border-accent text-accent" : "border-line"}`} onClick={() => setCategoryFilter(category)}>
            {category}
          </button>
        ))}
      </div>

      {visible.length === 0 ? <p className="rounded-lg border border-line bg-white px-4 py-8 text-sm text-muted">No products in this category yet.</p> : null}

      <div className="space-y-3">
        {visible.map((product) => {
          const low = Number(product.current_stock) <= Number(product.minimum_stock);
          return (
            <form key={product.id} className="space-y-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => event.preventDefault()}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">{product.category || "Uncategorised"}</p>
                  <h3 className="mt-1 text-base font-semibold">{product.name}</h3>
                  <p className="mt-1 text-sm text-muted">
                    <span className="font-semibold text-ink tabular">{product.current_stock}</span> in stock
                    {low ? " · low stock" : ""}
                    {product.supplier ? ` · ${product.supplier}` : ""}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-muted">Selling price</p>
                  <p className="font-semibold tabular">{Number(product.selling_price) > 0 ? inr(Number(product.selling_price)) : "Not set"}</p>
                </div>
              </div>

              {admin ? (
                <div className="grid gap-2 md:grid-cols-4">
                  <label className="text-xs font-medium text-muted">
                    Selling price ₹
                    <input name="selling" type="number" min={0} step="0.01" defaultValue={Number(product.selling_price)} className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
                  </label>
                  <label className="text-xs font-medium text-muted">
                    Purchase price ₹
                    <input name="purchase" type="number" min={0} step="0.01" defaultValue={Number(product.purchase_price)} className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
                  </label>
                  <label className="text-xs font-medium text-muted">
                    Low-stock alert
                    <input name="minimum" type="number" min={0} defaultValue={Number(product.minimum_stock)} className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink" />
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      disabled={busyId === product.id}
                      className="rounded-md border border-line px-3 py-1.5 text-sm"
                      onClick={(event) => {
                        const form = new FormData(event.currentTarget.form as HTMLFormElement);
                        setBusyId(product.id);
                        void updateProductPricing({
                          productId: product.id,
                          sellingPrice: Number(form.get("selling") || 0),
                          purchasePrice: Number(form.get("purchase") || 0),
                          minimumStock: Number(form.get("minimum") || 0),
                        })
                          .then(load)
                          .then(() => onNotice(`Price saved for ${product.name}.`))
                          .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the price"))
                          .finally(() => setBusyId(""));
                      }}
                    >
                      Save price
                    </button>
                    <button
                      type="button"
                      disabled={busyId === product.id}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-danger"
                      onClick={() => {
                        if (!window.confirm(`Remove ${product.name} from inventory?`)) return;
                        setBusyId(product.id);
                        void removeProduct(product.id)
                          .then(load)
                          .then(() => onNotice(`${product.name} removed.`))
                          .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not remove the product"))
                          .finally(() => setBusyId(""));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                <input name="qty" type="number" min={1} defaultValue={1} className="w-24 rounded-md border border-line px-2 py-1.5 text-sm" />
                <input name="note" placeholder="Reason" className="min-w-40 flex-1 rounded-md border border-line px-2 py-1.5 text-sm" />
                <button type="button" disabled={busyId === product.id} className="rounded-md border border-line px-3 py-1.5 text-sm" onClick={(event) => {
                  const form = new FormData(event.currentTarget.form as HTMLFormElement);
                  adjust(product.id, "purchase", Number(form.get("qty") || 1), String(form.get("note") || "Stock added"));
                }}>Add units</button>
                <button type="button" disabled={busyId === product.id} className="rounded-md border border-line px-3 py-1.5 text-sm" onClick={(event) => {
                  const form = new FormData(event.currentTarget.form as HTMLFormElement);
                  adjust(product.id, "adjustment", Number(form.get("qty") || 1), String(form.get("note") || "Stock reduced"));
                }}>Reduce units</button>
                <button type="button" disabled={busyId === product.id} className="rounded-md border border-line px-3 py-1.5 text-sm" onClick={(event) => {
                  const form = new FormData(event.currentTarget.form as HTMLFormElement);
                  adjust(product.id, "treatment", Number(form.get("qty") || 1), String(form.get("note") || "Treatment usage"));
                }}>Record usage</button>
              </div>
            </form>
          );
        })}
      </div>

      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Stock history</h2>
        {moves.length === 0 ? <p className="mt-2 text-sm text-muted">No stock movements yet.</p> : moves.map((move) => (
          <p key={move.id} className="mt-2 text-sm">
            {new Date(move.created_at).toLocaleString("en-IN")} · {productName(move.product_id)} · {move.transaction_type} · {move.quantity}
            {move.note ? ` · ${move.note}` : ""}
          </p>
        ))}
      </section>
    </div>
  );
}

function BillingPanel({ workspace, onError, onNotice }: PanelProps) {
  const [patients, setPatients] = useState<Array<{ id: string; full_name: string }>>([]);
  const [invoiceId, setInvoiceId] = useState("");
  useEffect(() => {
    void listPatients(workspace.id, "").then((rows) => setPatients(rows as typeof patients)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load patients"));
  }, [onError, workspace.id]);
  return (
    <div className="space-y-4">
    <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
      const invoice = await createInvoice({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        patientId: (data.get("patient") as string) || null,
        description: data.get("item") as string,
        quantity: Number(data.get("qty")),
        unitPrice: Number(data.get("price")),
        discount: Number(data.get("discount") || 0),
      });
      const paid = Number(data.get("paid") || 0);
      if (paid > 0) await recordPayment({ organizationId: workspace.organizationId, workspaceId: workspace.id, invoiceId: invoice.id, amount: paid, method: "cash" });
      setInvoiceId(invoice.id);
      onNotice(`${invoice.number} total ₹${invoice.total}. Payment recorded.`);
    }, onError)}>
      <h2 className="font-semibold">Invoice</h2>
      <select name="patient" className="w-full rounded-md border border-line px-2 py-2"><option value="">No patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name}</option>)}</select>
      <input name="item" required placeholder="Item" className="w-full rounded-md border border-line px-2 py-2" />
      <input name="qty" type="number" defaultValue={1} className="w-full rounded-md border border-line px-2 py-2" />
      <input name="price" type="number" required placeholder="Price" className="w-full rounded-md border border-line px-2 py-2" />
      <input name="discount" type="number" defaultValue={0} className="w-full rounded-md border border-line px-2 py-2" />
      <input name="paid" type="number" defaultValue={0} placeholder="Amount collected now" className="w-full rounded-md border border-line px-2 py-2" />
      <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Save invoice</button>
    </form>
    <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
      await recordRefund({ organizationId: workspace.organizationId, workspaceId: workspace.id, invoiceId: data.get("invoice") as string, amount: Number(data.get("amount")) });
      onNotice("Refund stored. Revenue uses this amount, not lead counts.");
    }, onError)}>
      <h2 className="font-semibold">Refund</h2>
      <input name="invoice" required defaultValue={invoiceId} placeholder="Invoice id" className="w-full rounded-md border border-line px-2 py-2" />
      <input name="amount" type="number" required placeholder="Amount" className="w-full rounded-md border border-line px-2 py-2" />
      <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Record refund</button>
    </form>
    </div>
  );
}

type PanelProps = { workspace: WorkspaceOption; onError: (value: string) => void; onNotice: (value: string) => void };

function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>, onError: (value: string) => void) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  void action(data).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Save failed"));
}
