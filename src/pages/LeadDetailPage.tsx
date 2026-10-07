import { useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { LeadForm } from "@/components/leads/LeadForm";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, PriorityBadge } from "@/components/shared/StatusBadge";
import { SendWhatsAppDialog } from "@/components/whatsapp/SendWhatsAppDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/context/CrmContext";
import { useAuth } from "@/context/AuthContext";
import { FOLLOW_UP_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { formatDateTime, toDateTimeLocal, tomorrowAt10 } from "@/lib/dates";
import { leadTimeline } from "@/lib/timeline";
import { userName } from "@/lib/template";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { ProductionLeadDetail } from "@/pages/ProductionLeadDetail";
import { formatTalk } from "@/lib/utils";
import type { FollowUpType, LeadStatus } from "@/types";

export function LeadDetailPage() {
  const { productionUser } = useAuth();
  const { id = "" } = useParams();
  if (productionUser && /^[0-9a-f-]{36}$/i.test(id)) return <ProductionLeadDetail id={id} />;
  return <DemoLeadDetail />;
}

function DemoLeadDetail() {
  const { id = "" } = useParams();
  const crm = useCrm();
  const lead = crm.state.leads.find((item) => item.id === id);
  const [edit, setEdit] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [whatsappKey, setWhatsappKey] = useState<string | undefined>(undefined);
  const [composer, setComposer] = useState<"call" | "email" | "follow" | "note" | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [followType, setFollowType] = useState<FollowUpType>("document_reminder");
  const [due, setDue] = useState(() => toDateTimeLocal(tomorrowAt10()));
  const [minutes, setMinutes] = useState(5);

  if (!lead) return <Navigate to="/leads" replace />;

  const timeline = leadTimeline(lead, crm.state.activities, crm.actorId);
  const followUps = crm.state.followUps.filter((item) => item.leadId === lead.id);
  const messages = crm.state.messages.filter((item) => item.leadId === lead.id).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const agent = userName(crm.state.users, lead.assignedTo);

  return (
    <div className="space-y-5">
      <Link to="/leads" className="text-xs text-muted hover:text-ink">Back to leads</Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[26px] font-semibold tracking-tight">{lead.fullName}</h1>
            <StatusBadge status={lead.status} />
            <PriorityBadge priority={lead.priority} />
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{lead.businessUnit === "clinic" ? "Clinic" : "Institute"}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{lead.whatsappAutomation ? "WhatsApp automation on" : "Direct call and WhatsApp only"}</span>
          </div>
          <p className="mt-1 text-sm text-muted">{lead.position} · {lead.location} · Assigned to {agent}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => { setWhatsappKey(undefined); setWhatsappOpen(true); }}>WhatsApp</Button>
          <Button type="button" variant="secondary" onClick={() => { setComposer("call"); setText(""); }}>Call</Button>
          <Button type="button" variant="secondary" onClick={() => { setComposer("email"); setText(""); }}>Email</Button>
          <Button type="button" variant="secondary" onClick={() => setEdit(true)}>Edit</Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Info title="Personal information" rows={[
            ["Phone", <PhoneLink key="phone" phone={lead.phone} />],
            ["WhatsApp", <PhoneLink key="whatsapp" phone={lead.whatsapp} />],
            ["Email", lead.email],
            ["Gender", lead.gender],
            ["Age", String(lead.age)],
            ["Place", lead.location],
            ["Country", lead.country],
            ["Talks", `${lead.callCount} · ${formatTalk(lead.talkSeconds)}`],
          ]} />
          <Info title={lead.businessUnit === "clinic" ? "Clinic enquiry" : "Institute enquiry"} rows={[
            ["Interest", lead.position],
            ["Department", lead.jobCategory],
            ["Background", lead.experience],
            ["Source", SOURCE_LABEL[lead.source]],
            ["Meta campaign", lead.metaCampaignName || "Not from Meta"],
            ["Status", STATUS_LABEL[lead.status]],
          ]} />
          <Card className="p-4">
            <p className="text-sm font-semibold">Move stage</p>
            <Select className="mt-2" value={lead.status} onChange={(event) => crm.setStatus(lead.id, event.target.value as LeadStatus)}>
              {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
            </Select>
            <Button type="button" className="mt-3 w-full" variant="secondary" onClick={() => crm.simulateReply(lead.id)}>Simulate candidate response</Button>
          </Card>
        </div>
        <Card className="p-4">
          <Tabs defaultValue="timeline">
            <TabsList className="flex w-full flex-wrap">
              <TabsTrigger value="timeline">Activity</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="followups">Follow-ups</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="communication">Communication</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="pt-4">
              <ol className="space-y-4 border-l border-line pl-4">
                {timeline.map((item) => (
                  <li key={item.id} className="relative">
                    <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-navy" />
                    <p className="text-xs text-muted">{formatDateTime(item.at)}</p>
                    <p className="text-sm font-medium">{item.action}</p>
                    <p className="text-sm text-muted">{item.details}</p>
                  </li>
                ))}
              </ol>
            </TabsContent>
            <TabsContent value="documents" className="space-y-2 pt-4">
              {lead.documents.map((document) => (
                <div key={document.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{document.name}</p>
                    <p className="text-xs text-muted capitalize">{document.status}</p>
                  </div>
                  <Select className="w-36" value={document.status} onChange={(event) => crm.updateDocument(lead.id, document.id, event.target.value as typeof document.status)}>
                    <option value="pending">Pending</option>
                    <option value="received">Received</option>
                    <option value="rejected">Rejected</option>
                  </Select>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="followups" className="pt-4">
              <div className="mb-3 flex gap-2">
                <Button type="button" size="sm" onClick={() => { setFollowType("document_reminder"); setComposer("follow"); }}>Document reminder</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => { setFollowType("general"); setComposer("follow"); }}>Add follow-up</Button>
              </div>
              {followUps.length === 0 ? <EmptyState title="No follow-ups yet" description="Schedule the next touch so this candidate does not go quiet." /> : (
                <ul className="space-y-2">
                  {followUps.map((item) => (
                    <li key={item.id} className="rounded-md border border-line px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{FOLLOW_UP_LABEL[item.type]}</span>
                        <span className="text-xs text-muted">{item.status}</span>
                      </div>
                      <p className="text-muted">{formatDateTime(item.dueAt)}</p>
                      {item.notes ? <p className="mt-1">{item.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="notes" className="pt-4">
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a desk note" />
              <Button type="button" className="mt-2" onClick={() => { crm.addNote(lead.id, note); setNote(""); }}>Add note</Button>
              <ul className="mt-4 space-y-3">
                {lead.noteEntries.map((note) => (
                  <li key={note.id}>
                    <p className="text-sm">{note.body}</p>
                    <p className="text-xs text-muted">{userName(crm.state.users, note.userId)} · {formatDateTime(note.createdAt)}</p>
                  </li>
                ))}
                {!lead.noteEntries.length && lead.notes ? <li className="text-sm">{lead.notes}</li> : null}
              </ul>
            </TabsContent>
            <TabsContent value="communication" className="pt-4">
              <div className="mb-3 flex gap-2">
                <Button type="button" size="sm" onClick={() => { setWhatsappKey("WELCOME_MESSAGE"); setWhatsappOpen(true); }}>Welcome message</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => { setWhatsappKey("DOCUMENT_REMINDER"); setWhatsappOpen(true); }}>Document reminder</Button>
                <Link to={`/whatsapp?lead=${lead.id}`} className="inline-flex h-8 items-center text-[13px] text-muted hover:text-ink">Open conversation</Link>
              </div>
              {messages.length === 0 ? <EmptyState title="No messages yet" description="Send a welcome message to start the thread." /> : (
                <ul className="space-y-2">
                  {messages.map((message) => (
                    <li key={message.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${message.direction === "out" ? "ml-auto bg-navy text-white" : "bg-slate-100"}`}>
                      <p>{message.body}</p>
                      <p className={`mt-1 text-[11px] ${message.direction === "out" ? "text-slate-300" : "text-muted"}`}>{message.status === "failed" ? "Failed · Demo" : formatDateTime(message.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </div>
      <Sheet open={edit} onOpenChange={setEdit}>
        <SheetContent title="Edit lead">{edit ? <LeadForm lead={lead} onClose={() => setEdit(false)} /> : null}</SheetContent>
      </Sheet>
      <SendWhatsAppDialog lead={lead} open={whatsappOpen} templateKey={whatsappKey} onOpenChange={setWhatsappOpen} />
      <Dialog open={Boolean(composer)} onOpenChange={(open) => { if (!open) setComposer(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{composer === "call" ? "Log a call" : composer === "email" ? "Log an email" : "Schedule follow-up"}</DialogTitle></DialogHeader>
          {composer === "follow" ? (
            <div className="space-y-3">
              <Select value={followType} onChange={(event) => setFollowType(event.target.value as FollowUpType)}>
                {Object.entries(FOLLOW_UP_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              <Input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
              <Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Notes" />
            </div>
          ) : composer === "call" ? (
            <div className="space-y-3">
              <label className="block text-sm">Minutes on the call
                <Input className="mt-1" type="number" min={1} value={minutes} onChange={(event) => setMinutes(Number(event.target.value) || 1)} />
              </label>
              <Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="What was discussed?" />
            </div>
          ) : (
            <Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Email summary" />
          )}
          <p className="mt-2 text-xs text-muted">Demo Mode — nothing is dialled or emailed outside this prototype.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setComposer(null)}>Cancel</Button>
            <Button type="button" onClick={() => {
              if (composer === "call") crm.logCall(lead.id, text, Math.max(1, minutes) * 60);
              if (composer === "email") crm.logEmail(lead.id, text);
              if (composer === "follow") crm.createFollowUp({ leadId: lead.id, type: followType, dueAt: new Date(due).toISOString(), notes: text || "Document reminder" });
              setComposer(null);
              setText("");
            }}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_1fr] gap-2 text-sm">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
