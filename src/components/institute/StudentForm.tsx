import type { DeskStudent, StudentDetails } from "@/services/production-ops";

const field = "mt-1 h-11 w-full rounded-md border border-line px-3";

export function StudentForm({ value, onChange, photo, onPhoto }: {
  value: StudentDetails;
  onChange: (next: StudentDetails) => void;
  photo?: File | null;
  onPhoto?: (file: File | null) => void;
}) {
  const set = (patch: Partial<StudentDetails>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">Student name
        <input required value={value.fullName} onChange={(event) => set({ fullName: event.target.value })} className={field} />
      </label>
      <label className="text-sm">Mobile
        <input value={value.mobile} inputMode="tel" onChange={(event) => set({ mobile: event.target.value })} className={field} />
      </label>
      <label className="text-sm">Email
        <input type="email" value={value.email} onChange={(event) => set({ email: event.target.value })} className={field} />
      </label>
      <label className="text-sm">Gender
        <select value={value.gender || "other"} onChange={(event) => set({ gender: event.target.value })} className={field}>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="text-sm">Date of birth
        <input type="date" value={value.dateOfBirth || ""} onChange={(event) => set({ dateOfBirth: event.target.value || null })} className={field} />
      </label>
      <label className="text-sm sm:col-span-2">Address
        <textarea value={value.address} onChange={(event) => set({ address: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-line px-3 py-2" />
      </label>
      <label className="text-sm">Course
        <input value={value.course} onChange={(event) => set({ course: event.target.value })} className={field} />
      </label>
      <label className="text-sm">Batch
        <input value={value.batch} onChange={(event) => set({ batch: event.target.value })} className={field} />
      </label>
      <label className="text-sm">{value.status === "booked" ? "Booked date" : "Admission date"}
        <input type="date" required={value.status === "booked"} value={value.admissionDate || ""} onChange={(event) => set({ admissionDate: event.target.value || null })} className={field} />
      </label>
      <label className="text-sm">Status
        <select value={value.status || "admitted"} onChange={(event) => {
          const status = event.target.value;
          set({ status, admissionDate: status === "booked" && !value.admissionDate ? new Date().toISOString().slice(0, 10) : value.admissionDate });
        }} className={field}>
          <option value="enquiry">Enquiry</option>
          <option value="booked">Booked</option>
          <option value="admitted">Admitted</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
        </select>
      </label>
      {value.status === "booked" ? (
        <>
          <label className="text-sm">Appointment date
            <input required type="datetime-local" value={value.appointmentAt || ""} onChange={(event) => set({ appointmentAt: event.target.value })} className={field} />
          </label>
          <label className="text-sm">Fee
            <input inputMode="decimal" value={value.fee || ""} onChange={(event) => set({ fee: event.target.value })} className={field} />
          </label>
          <label className="text-sm">Paid now
            <input inputMode="decimal" value={value.paid || ""} onChange={(event) => set({ paid: event.target.value })} className={field} />
          </label>
          <label className="text-sm">Payment
            <select value={value.method || "cash"} onChange={(event) => set({ method: event.target.value as "cash" | "upi" | "card" })} className={field}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
            </select>
          </label>
          <p className="flex items-end text-sm font-semibold">Balance ₹{Math.max(0, Number(value.fee || 0) - Number(value.paid || 0)).toLocaleString("en-IN")}</p>
        </>
      ) : null}
      {onPhoto ? (
        <label className="text-sm sm:col-span-2">Photo
          <input type="file" accept="image/*" className="mt-1 w-full text-sm" onChange={(event) => onPhoto(event.target.files?.[0] ?? null)} />
          {photo ? <span className="mt-1 block text-xs text-muted">{photo.name}</span> : null}
        </label>
      ) : null}
    </div>
  );
}

export function detailsFromStudent(student: DeskStudent): StudentDetails {
  return {
    fullName: student.full_name,
    mobile: student.mobile,
    email: student.email,
    gender: student.gender || "other",
    dateOfBirth: student.date_of_birth,
    address: student.address,
    course: student.course,
    batch: student.batch,
    admissionDate: student.admission_date,
    status: student.status || "admitted",
  };
}

export function blankStudent(): StudentDetails {
  return { fullName: "", mobile: "", email: "", gender: "other", dateOfBirth: null, address: "", course: "", batch: "", admissionDate: null, status: "enquiry" };
}
