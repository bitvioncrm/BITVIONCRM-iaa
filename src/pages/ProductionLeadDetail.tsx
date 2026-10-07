import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { addFollowUp, addLeadNote, getLead, listFollowUps, listNotes, listWorkspaces, updateLeadStatus, type ProductionLead } from "@/services/production-leads";
import { createCourse, createPatient, createStudent, endCall, startCall } from "@/services/production-ops";
import type { LeadStatus } from "@/types";

export function ProductionLeadDetail({ id }: { id: string }) {
  const [lead, setLead] = useState<ProductionLead | null | undefined>(undefined);
  const [notes, setNotes] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [followups, setFollowups] = useState<{ id: string; due_at: string; notes: string; status: string }[]>([]);
  const [workspaceType, setWorkspaceType] = useState("clinic");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [note, setNote] = useState("");
  const [followAt, setFollowAt] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void getLead(id)
      .then(async (row) => {
        setLead(row);
        if (!row) return;
        const workspaces = await listWorkspaces();
        setWorkspaceType(workspaces.find((item) => item.id === row.workspaceId)?.workspaceType ?? "clinic");
        setNotes(await listNotes(row.id));
        setFollowups(await listFollowUps(row.id));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the lead"));
  }, [id]);

  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, [sessionId]);

  if (lead === null) return <Navigate to="/leads" replace />;
  if (!lead) return <p className="text-sm text-muted">{error || "Loading lead from PostgreSQL."}</p>;

  const institute = workspaceType === "institute";
  const live = startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : 0;
  const nextDesk = institute ? "/institute" : "/clinic";

  return (
    <div className="space-y-4">
      <Link to="/leads" className="text-sm text-muted">Back to leads</Link>
      <h1 className="text-2xl font-semibold">{lead.fullName}</h1>
      <PhoneLink phone={lead.phone} />
      <p className="text-sm text-muted">{lead.email} · {lead.location} · {lead.position}</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm">{notice}</p> : null}
      <Select
        value={lead.status}
        onChange={(event) => {
          const status = event.target.value as LeadStatus;
          void updateLeadStatus(lead, status)
            .then(() => setLead({ ...lead, status }))
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not update the stage"));
        }}
      >
        {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
      </Select>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="font-semibold">Call time</h2>
        <p className="mt-1 text-sm text-muted">The timer on screen is not saved. Only End call stores the elapsed time.</p>
        <p className="mt-3 text-3xl font-semibold tabular">{sessionId ? `${Math.floor(live / 60)}:${String(live % 60).padStart(2, "0")}` : "0:00"}</p>
        {sessionId ? (
          <Button type="button" className="mt-3" onClick={() => {
            void endCall(sessionId).then((seconds) => {
              setSessionId(null);
              setStartedAt(null);
              setNotice(`Call saved: ${seconds} seconds.`);
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "End call failed"));
          }}>End call</Button>
        ) : (
          <Button type="button" className="mt-3" onClick={() => {
            void startCall(lead.organizationId, lead.workspaceId).then((row) => {
              setSessionId(row.id);
              setStartedAt(row.started_at);
              setNotice("");
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Start call failed"));
          }}>Start call</Button>
        )}
      </section>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="font-semibold">{institute ? "Convert to student" : "Convert to patient"}</h2>
        <p className="mt-1 text-sm text-muted">This marks the lead converted and creates the {institute ? "student and admission" : "patient"} in the same workspace.</p>
        <Button type="button" className="mt-3" onClick={() => {
          void updateLeadStatus(lead, "converted")
            .then(async () => {
              setLead({ ...lead, status: "converted" });
              if (institute) {
                const courseId = await createCourse({ organizationId: lead.organizationId, workspaceId: lead.workspaceId, name: lead.position || "Course" });
                const code = await createStudent({ organizationId: lead.organizationId, workspaceId: lead.workspaceId, fullName: lead.fullName, mobile: lead.phone, courseId, leadId: lead.id });
                setNotice(`Student ${code} admitted. Continue on the Institute desk.`);
              } else {
                const code = await createPatient({ organizationId: lead.organizationId, workspaceId: lead.workspaceId, fullName: lead.fullName, mobile: lead.phone, place: lead.location, email: lead.email, leadId: lead.id });
                setNotice(`Patient ${code} registered. Book the appointment on the Clinic desk.`);
              }
            })
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Conversion failed"));
        }}>Convert</Button>
        <Link to={nextDesk} className="ml-3 text-sm underline">Open {institute ? "Institute" : "Clinic"} desk</Link>
      </section>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (!note.trim()) return;
        void addLeadNote(lead, note).then(() => listNotes(lead.id)).then((rows) => { setNotes(rows); setNote(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the note"));
      }}>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note" className="min-w-48 flex-1 rounded-md border border-line px-2 py-2" />
        <Button type="submit" variant="secondary">Add note</Button>
      </form>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (!followAt) return;
        void addFollowUp(lead, new Date(followAt).toISOString(), "Follow-up").then(() => listFollowUps(lead.id)).then((rows) => { setFollowups(rows); setFollowAt(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save the follow-up"));
      }}>
        <input type="datetime-local" value={followAt} onChange={(event) => setFollowAt(event.target.value)} className="rounded-md border border-line px-2 py-2" />
        <Button type="submit" variant="secondary">Add follow-up</Button>
      </form>
      <section>
        <h2 className="text-sm font-semibold">Notes</h2>
        {notes.length === 0 ? <p className="text-sm text-muted">No notes.</p> : notes.map((item) => <p key={item.id} className="mt-2 text-sm">{item.body}</p>)}
      </section>
      <section>
        <h2 className="text-sm font-semibold">Follow-ups</h2>
        {followups.length === 0 ? <p className="text-sm text-muted">No follow-ups.</p> : followups.map((item) => <p key={item.id} className="mt-2 text-sm">{item.due_at} · {item.status} · {item.notes}</p>)}
      </section>
    </div>
  );
}
