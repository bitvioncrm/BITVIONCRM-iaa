import { useEffect, useMemo, useState, type FormEvent } from "react";
import { StudentFile } from "@/components/institute/StudentFile";
import { blankStudent, detailsFromStudent, StudentForm } from "@/components/institute/StudentForm";
import { Portrait } from "@/components/shared/Portrait";
import { FilterBar, patientAssignedToDoctor, studentMatches, type DeskFilter } from "@/pages/production/ProductionDashboard";
import { Sheet, SheetBody, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { PatientHistory } from "@/components/clinic/PatientHistory";
import { BusinessBoard } from "@/components/dashboard/BusinessBoard";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp, isClinicDoctor } from "@/lib/production-access";
import { listDoctors, listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { DialLink } from "@/components/calls/DialLink";
import { phoneTel } from "@/lib/phone";
import { inr } from "@/lib/money";
import { BillingDesk } from "@/components/clinic/BillingDesk";
import { changeStock, clearDeskCache, createAppointment, createExam, createPatient, createProduct, createStudent, documentTypeLabel, issueCertificate, listCertificates, listDeskAppointments, listDeskPatients, listDeskStudents, listDocuments, listExams, listProducts, listStockMoves, recordMark, removeAppointment, removeDocument, removeProduct, removeStudent, savePersonPhoto, saveStudentDetails, seedClinicSkincareStock, setDocumentStatus, signedDocumentUrl, STUDENT_DOCUMENT_TYPES, updateAppointment, updateDocument, updateProductPricing, uploadPrivateFile, type DeskAppointmentRow, type DeskPatient, type DeskStudent, type InventoryProduct, type StudentDetails } from "@/services/production-ops";

export function ProductionModule({ module }: { module: "clinic" | "institute" | "inventory" | "billing" | "institute-billing" }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const workspace = workspaces.find((item) => item.id === workspaceId);

  useEffect(() => {
    void listWorkspaces().then((rows) => {
      const visible = module === "clinic" || module === "institute"
        ? rows.filter((item) => item.workspaceType === module)
        : module === "inventory" || module === "billing"
          ? rows.filter((item) => item.workspaceType === "clinic")
          : module === "institute-billing"
            ? rows.filter((item) => item.workspaceType === "institute")
            : rows;
      setWorkspaces(visible);
      setWorkspaceId((current) => visible.some((item) => item.id === current) ? current : visible[0]?.id || "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, [module]);

  const admin = canOperateWhatsApp(useAuth().productionUser?.roleKey ?? "");
  const showBoard = admin && (module === "clinic" || module === "institute");
  return (
    <div className="space-y-4">
      {showBoard && (module === "clinic" || module === "institute") ? <BusinessBoard desk={module} variant="operations" /> : <h1 className="text-2xl font-semibold">{module === "billing" || module === "institute-billing" ? "Billing" : module === "institute" ? "Institute" : module === "clinic" ? "Clinic" : "Inventory"}</h1>}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm">{notice}</p> : null}
      {workspaces.length > 1 ? (
        <select className="rounded-md border border-line px-2 py-2" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
          {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      ) : null}
      {!workspace ? <p className="text-sm text-muted">This desk is not available.</p> : null}
      {workspace && module === "clinic" ? <ClinicPanel workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
      {workspace && module === "institute" ? <InstitutePanel workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
      {workspace && module === "inventory" ? <InventoryPanel workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
      {workspace && module === "billing" ? <BillingDesk workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
      {workspace && module === "institute-billing" ? <BillingDesk mode="institute" workspace={workspace} onError={setError} onNotice={setNotice} /> : null}
    </div>
  );
}

function ClinicPanel({ workspace, onError, onNotice }: PanelProps) {
  const { productionUser } = useAuth();
  const doctorOnly = isClinicDoctor(productionUser?.roleKey ?? "");
  const [patients, setPatients] = useState<DeskPatient[]>([]);
  const [appointments, setAppointments] = useState<DeskAppointmentRow[]>([]);
  const [doctors, setDoctors] = useState<Array<{ userId: string; name: string }>>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const scopedPatients = useMemo(() => {
    if (!doctorOnly || !productionUser?.userId) return patients;
    return patients.filter((item) => patientAssignedToDoctor(item, productionUser.userId));
  }, [doctorOnly, patients, productionUser?.userId]);
  const open = scopedPatients.find((item) => item.id === openId) ?? patients.find((item) => item.id === openId) ?? null;
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return scopedPatients;
    return scopedPatients.filter((item) => `${item.full_name} ${item.mobile} ${item.patient_code} ${item.place}`.toLowerCase().includes(term));
  }, [scopedPatients, query]);
  const visibleAppointments = useMemo(() => {
    if (!doctorOnly || !productionUser?.userId) return appointments;
    return appointments.filter((item) => item.doctorId === productionUser.userId);
  }, [appointments, doctorOnly, productionUser?.userId]);
  const reload = () => {
    clearDeskCache();
    void listDeskPatients(workspace.id).then(setPatients).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load patients"));
    void listDeskAppointments(workspace.id).then(setAppointments).catch(() => setAppointments([]));
  };
  useEffect(() => {
    reload();
    void listDoctors(workspace.id).then(setDoctors).catch(() => setDoctors([]));
  }, [workspace.id]);
  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-semibold">Patients</h2>
          <p className="text-sm text-muted">{visible.length}</p>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, mobile, or code" className="h-11 w-full rounded-xl border border-line bg-white px-3" />
        {visible.length === 0 ? <p className="rounded-2xl border border-line bg-white px-4 py-8 text-sm text-muted">No patients yet.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((patient) => {
              const latest = [...patient.treatments].sort((left, right) => right.performed_on.localeCompare(left.performed_on))[0];
              return (
                <button key={patient.id} type="button" onClick={() => setOpenId(patient.id)} className="touch-card flex gap-3 rounded-2xl border border-line bg-white p-3 text-left">
                  <Portrait name={patient.full_name} path={patient.photo_path} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{patient.full_name}</span>
                    <span className="mt-1 block text-xs text-muted">{patient.patient_code} · {patient.mobile || "No mobile"}</span>
                    <span className="mt-2 block text-sm">{latest ? `Last visit ${latest.performed_on} · ${latest.title}` : "No treatment recorded yet"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {doctorOnly ? null : (
      <details className="rounded-2xl border border-line bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold">Register a patient</summary>
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => submit(event, async (data) => {
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
          onNotice(`Patient ${code} saved. Same mobile updates the existing card instead of adding another.`);
          clearDeskCache();
          reload();
        }, onError)}>
          <label className="text-sm sm:col-span-2">Full name<input name="name" required className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Date of birth<input name="dob" type="date" className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Gender
            <select name="gender" className="mt-1 h-11 w-full rounded-md border border-line px-3"><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select>
          </label>
          <label className="text-sm">Mobile<input name="mobile" required inputMode="tel" className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Email<input name="email" type="email" className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm sm:col-span-2">Address<input name="address" className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Place<input name="place" className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Emergency contact<input name="emergency" className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm sm:col-span-2">Notes<textarea name="notes" className="mt-1 min-h-16 w-full rounded-md border border-line px-3 py-2" /></label>
          <button className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:col-span-2" type="submit">Save patient</button>
        </form>
      </details>
      )}

      <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
        <h2 className="font-semibold">{doctorOnly ? "Your queue" : "Queue"}</h2>
        {doctorOnly ? <p className="text-sm text-muted">Only patients assigned to you. Reception chooses Doctor Rimisha, Siji, or Bhama when booking.</p> : null}
        {doctorOnly ? null : (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => submit(event, async (data) => {
          if (!doctorId) throw new Error("Assign Doctor Rimisha, Doctor Siji, or Doctor Bhama.");
          await createAppointment({
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
            patientId,
            doctorId,
            startsAt: new Date(data.get("when") as string).toISOString(),
            reason: data.get("reason") as string,
            status: data.get("walkin") === "on" ? "arrived" : "scheduled",
          });
          onNotice("Appointment saved and assigned to the doctor.");
          reload();
        }, onError)}>
          <label className="text-sm">Patient
            <select required value={patientId} onChange={(event) => setPatientId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
              <option value="">Choose a patient</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name}</option>)}
            </select>
          </label>
          <label className="text-sm">Assign doctor
            <select required value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line px-3">
              <option value="">Choose Doctor Rimisha, Siji, or Bhama</option>
              {doctors.map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm">When<input name="when" type="datetime-local" required className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="text-sm">Reason<input name="reason" className="mt-1 h-11 w-full rounded-md border border-line px-3" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input name="walkin" type="checkbox" /> Walk-in, mark arrived</label>
          <button className="min-h-11 rounded-md bg-navy px-3 text-sm text-white sm:col-span-2" type="submit">Book</button>
        </form>
        )}
        <div className="space-y-2">
          {visibleAppointments.map((item) => (
            <article key={item.id} className="touch-card space-y-2 rounded-2xl border border-line p-3 text-sm">
              <button type="button" className="text-left" onClick={() => setOpenId(item.patientId)}>
                <p className="font-medium">{item.patientName}</p>
                <p className="mt-1 text-muted">{whenLabel(item.startsAt)}{item.reason ? ` · ${item.reason}` : ""}{item.doctorId ? ` · ${doctors.find((doctor) => doctor.userId === item.doctorId)?.name || "Doctor"}` : ""}</p>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {doctorOnly ? null : (
                  <select value={item.doctorId || ""} onChange={(event) => {
                    void updateAppointment(item.id, { doctorId: event.target.value || null }).then(reload).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not assign the doctor"));
                  }} className="h-11 min-w-0 flex-1 rounded-md border border-line px-2">
                    <option value="">Choose doctor</option>
                    {doctors.map((doctor) => <option key={doctor.userId} value={doctor.userId}>{doctor.name}</option>)}
                  </select>
                )}
                <select value={item.status} onChange={(event) => {
                  void updateAppointment(item.id, { status: event.target.value }).then(reload).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the appointment"));
                }} className="h-11 min-w-0 flex-1 rounded-md border border-line px-2 capitalize">
                  {["scheduled", "confirmed", "arrived", "in_consultation", "completed", "cancelled", "no_show"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                </select>
                {doctorOnly ? null : (
                  <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                    if (!window.confirm("Delete this appointment?")) return;
                    void removeAppointment(item.id).then(() => { onNotice("Appointment deleted."); reload(); }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the appointment"));
                  }}>Delete</button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <Sheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpenId(""); }}>
        {open ? (
          <SheetContent title={open.full_name}>
            <SheetHeader>
              <p className="text-lg font-semibold">Patient history</p>
              <p className="text-sm text-muted">Treatments, products used, and how long each medicine was given.</p>
            </SheetHeader>
            <SheetBody>
              <PatientHistory
                patient={open}
                workspace={workspace}
                doctors={doctors}
                currentUserId={productionUser?.userId ?? ""}
                onChanged={(next) => {
                  setPatients((current) => current.map((item) => item.id === next.id ? next : item));
                  reload();
                }}
                onDeleted={() => { setOpenId(""); onNotice("Patient deleted."); reload(); }}
                onNotice={onNotice}
                onError={onError}
              />
            </SheetBody>
          </SheetContent>
        ) : null}
      </Sheet>
    </div>
  );
}

function whenLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function applyDetails(student: DeskStudent, details: StudentDetails): DeskStudent {
  return {
    ...student,
    full_name: details.fullName.trim(),
    mobile: details.mobile.trim(),
    email: details.email.trim(),
    gender: details.gender,
    date_of_birth: details.dateOfBirth,
    address: details.address.trim(),
    course: details.course.trim(),
    batch: details.batch.trim(),
    admission_date: details.admissionDate,
    status: details.status,
  };
}

function InstitutePanel({ workspace, onError, onNotice }: PanelProps) {
  const [students, setStudents] = useState<DeskStudent[]>([]);
  const [open, setOpen] = useState<DeskStudent | null>(null);
  const [edit, setEdit] = useState<StudentDetails>(blankStudent);
  const [draft, setDraft] = useState<StudentDetails>(blankStudent);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<DeskFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const visible = useMemo(() => students.filter((student) => studentMatches(student, filter, customFrom, customTo)), [students, filter, customFrom, customTo]);
  const load = () => void listDeskStudents(workspace.id).then(setStudents).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load students"));
  useEffect(() => {
    void listDeskStudents(workspace.id).then(setStudents).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load students"));
  }, [onError, workspace.id]);
  const show = (student: DeskStudent) => {
    setOpen(student);
    setEdit(detailsFromStudent(student));
  };
  const changePhoto = (student: DeskStudent, file: File) => {
    void savePersonPhoto("students", student.id, workspace.organizationId, workspace.id, file)
      .then((path) => {
        setStudents((current) => current.map((item) => item.id === student.id ? { ...item, photo_path: path } : item));
        setOpen((current) => current && current.id === student.id ? { ...current, photo_path: path } : current);
        onNotice("Photo saved.");
      })
      .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the photo"));
  };
  const remove = (student: DeskStudent) => {
    if (!window.confirm(`Delete ${student.full_name}?`)) return;
    void removeStudent(student.id).then(() => {
      setStudents((current) => current.filter((item) => item.id !== student.id));
      setOpen((current) => current?.id === student.id ? null : current);
      onNotice("Student deleted.");
    }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the student"));
  };
  const saveOpen = () => {
    if (!open) return;
    setSaving(true);
    void saveStudentDetails(open.id, workspace.organizationId, workspace.id, edit)
      .then(() => {
        const next = applyDetails(open, edit);
        setStudents((current) => current.map((item) => item.id === open.id ? next : item));
        setOpen(next);
        onNotice("Student saved.");
      })
      .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the student"))
      .finally(() => setSaving(false));
  };
  return (
    <div className="space-y-4">
    <form className="space-y-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      setSaving(true);
      void (async () => {
        const code = await createStudent({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          fullName: draft.fullName,
          mobile: draft.mobile,
          email: draft.email,
          gender: draft.gender,
          dateOfBirth: draft.dateOfBirth,
          address: draft.address,
          courseId: null,
          courseName: draft.course,
          batchName: draft.batch,
          admissionDate: draft.admissionDate,
          status: draft.status,
          appointmentAt: draft.appointmentAt,
          fee: draft.fee,
          paid: draft.paid,
          method: draft.method,
          photo,
        });
        onNotice(`Student ${code} admitted.`);
        setDraft(blankStudent());
        setPhoto(null);
        load();
      })().catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not admit the student")).finally(() => setSaving(false));
    }}>
      <h2 className="font-semibold">Admit student</h2>
      <StudentForm value={draft} onChange={setDraft} photo={photo} onPhoto={setPhoto} />
      <button className="min-h-11 rounded-md bg-navy px-3 text-sm text-white" type="submit" disabled={saving}>{saving ? "Saving" : "Admit"}</button>
    </form>
    <FilterBar filter={filter} customFrom={customFrom} customTo={customTo} onFilter={setFilter} onFrom={setCustomFrom} onTo={setCustomTo} count={visible.length} noun="students" labels={{ appointment_today: "Admitted today", upcoming: "Upcoming admissions" }} />
    {visible.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">No students in this range.</p> : (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((student) => (
          <div key={student.id} className="touch-card rounded-2xl border border-line bg-white p-4 text-left shadow-sm sm:transition sm:hover:-translate-y-0.5 sm:hover:border-[#c6a15b] sm:hover:shadow-md">
          <button type="button" onClick={() => show(student)} className="w-full text-left">
            <span className="flex items-start gap-3">
              <Portrait name={student.full_name} path={student.photo_path} />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold break-words">{student.full_name}</span>
                <span className="mt-0.5 block text-xs text-muted">{student.student_code}</span>
                <span className="mt-2 block text-sm">{student.mobile || "No mobile"}</span>
                <span className="mt-1 block text-xs text-muted">{student.course || "No course"}{student.batch ? ` · ${student.batch}` : ""}</span>
              </span>
            </span>
          </button>
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm" onClick={() => show(student)}>Edit</button>
            <button type="button" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-danger" onClick={() => remove(student)}>Delete</button>
            {phoneTel(student.mobile) ? <DialLink organizationId={workspace.organizationId} workspaceId={workspace.id} leadId={student.lead_id || null} name={student.full_name} phone={student.mobile} /> : null}
          </span>
          </div>
        ))}
      </div>
    )}
    <Sheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpen(null); }}>
      {open ? (
        <SheetContent title={open.full_name}>
          <SheetHeader>
            <div className="flex items-center gap-3">
              <Portrait name={open.full_name} path={open.photo_path} className="size-16 text-xl" />
              <div>
                <p className="text-xs font-medium tracking-wide text-[#a6843d] uppercase">{open.student_code}</p>
                <h2 className="text-xl font-semibold break-words">{open.full_name}</h2>
              </div>
            </div>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line px-3 text-sm">
              Change photo
              <input type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) changePhoto(open, file); }} />
            </label>
            <StudentForm value={edit} onChange={setEdit} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-md bg-navy px-4 text-sm text-white" disabled={saving} onClick={saveOpen}>{saving ? "Saving" : "Save student"}</button>
              <button type="button" className="min-h-11 rounded-md px-3 text-sm font-medium text-danger" onClick={() => remove(open)}>Delete</button>
            </div>
            <StudentFile organizationId={workspace.organizationId} workspaceId={workspace.id} studentId={open.id} onError={onError} onNotice={onNotice} />
          </SheetBody>
        </SheetContent>
      ) : null}
    </Sheet>
    <AcademicPanel workspace={workspace} students={students} onError={onError} onNotice={onNotice} />
    </div>
  );
}

function AcademicPanel({ workspace, students, onError, onNotice }: PanelProps & { students: Array<{ id: string; full_name: string }> }) {
  const [exams, setExams] = useState<Array<{ id: string; name: string }>>([]);
  const [certificates, setCertificates] = useState<Array<{ id: string; title: string; certificate_number: string; issued_on: string; status: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; filename: string; category: string; verification_status: string; storage_path: string }>>([]);
  const [documentStudent, setDocumentStudent] = useState("");
  const activeStudent = documentStudent || students[0]?.id || "";
  const reloadDocuments = (studentId: string) => listDocuments(workspace.id, studentId).then((rows) => setDocuments(rows as typeof documents));
  useEffect(() => {
    void listExams(workspace.id).then((rows) => setExams(rows as typeof exams)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not load exams"));
    void listCertificates(workspace.id).then((rows) => setCertificates(rows as typeof certificates)).catch(() => setCertificates([]));
  }, [onError, workspace.id]);
  useEffect(() => {
    if (!activeStudent) return;
    void reloadDocuments(activeStudent).catch(() => setDocuments([]));
  }, [activeStudent, workspace.id]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="space-y-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => submit(event, async (data) => {
        const file = data.get("file");
        if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF, JPG, JPEG, PNG, or WEBP file.");
        const studentId = data.get("student") as string;
        const sizes = await uploadPrivateFile({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          entityType: "student",
          entityId: studentId,
          file,
          category: (data.get("category") as string) || "aadhaar",
        });
        onNotice(sizes.optimizedSize < sizes.originalSize
          ? `Document saved and compressed for storage.`
          : "Document saved on the student file.");
        setDocumentStudent(studentId);
        await reloadDocuments(studentId);
      }, onError)}>
        <h2 className="font-semibold">Student document</h2>
        <p className="text-xs text-muted">Aadhaar, PAN, other IDs, or academic files. Images are compressed automatically.</p>
        <select name="student" className="w-full rounded-md border border-line px-2 py-2" value={activeStudent} onChange={(event) => setDocumentStudent(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>
        <select name="category" defaultValue="aadhaar" className="w-full rounded-md border border-line px-2 py-2">
          {STUDENT_DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" className="w-full text-sm" />
        <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Upload</button>
        {documents.map((item) => (
          <div key={item.id} className="space-y-2 rounded-xl border border-line px-3 py-2 text-sm">
            <p className="font-medium break-words">{item.filename}</p>
            <p className="text-xs text-muted">{documentTypeLabel(item.category)} · {item.verification_status}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="min-h-11 rounded-md border border-line px-2" onClick={() => void signedDocumentUrl(item.storage_path).then((url) => window.open(url, "_blank", "noopener")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not open the file"))}>Download</button>
              <select value={STUDENT_DOCUMENT_TYPES.some((row) => row.value === item.category) ? item.category : "other"} onChange={(event) => void updateDocument(item.id, { category: event.target.value }).then(() => reloadDocuments(activeStudent)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the document"))} className="h-11 rounded-md border border-line px-2">
                {STUDENT_DOCUMENT_TYPES.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
              </select>
              <select value={item.verification_status} onChange={(event) => void setDocumentStatus(item.id, event.target.value).then(() => reloadDocuments(activeStudent)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not update the document"))} className="h-11 rounded-md border border-line px-2 capitalize">
                {["pending", "verified", "rejected"].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <button type="button" className="min-h-11 text-sm font-medium text-danger" onClick={() => {
                if (!window.confirm(`Delete ${item.filename}?`)) return;
                void removeDocument(item.id).then(() => reloadDocuments(activeStudent)).then(() => onNotice("Document deleted.")).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not delete the document"));
              }}>Delete</button>
            </div>
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

type PanelProps = { workspace: WorkspaceOption; onError: (value: string) => void; onNotice: (value: string) => void };

function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>, onError: (value: string) => void) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  void action(data).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Save failed"));
}
