import { format } from "date-fns";
import { ImagePlus, Paperclip } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp } from "@/lib/production-access";
import { listVisibleMessages } from "@/services/production-ops";
import { useCrm } from "@/context/CrmContext";
import { inDayRange } from "@/lib/day-filter";
import { formatTime, toDateTimeLocal, tomorrowAt10 } from "@/lib/dates";
import { deskLeads } from "@/lib/scope";
import { renderTemplate, userName } from "@/lib/template";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types";

const SEND_LIMIT = 30;

export function WhatsAppPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionWhatsApp />;
  return <DemoWhatsApp />;
}

function ProductionWhatsApp() {
  const { productionUser } = useAuth();
  const operate = canOperateWhatsApp(productionUser?.roleKey ?? "");
  const [status, setStatus] = useState("");
  const [template, setTemplate] = useState("");
  const [to, setTo] = useState("");
  const [leadId, setLeadId] = useState("");
  const [messages, setMessages] = useState<Array<{ id: string; body: string; direction: string; status: string; created_at: string }>>([]);
  useEffect(() => {
    void listVisibleMessages().then((rows) => setMessages(rows as typeof messages)).catch((reason: unknown) => setStatus(reason instanceof Error ? reason.message : "Could not load messages"));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">WhatsApp</h1>
      <p className="text-sm text-muted">{operate ? "Admin can send an approved template. A message is stored only after Meta accepts it." : "View only. Sending, templates, campaigns, and automation are limited to Admin."}</p>
      {operate ? (
        <form className="max-w-lg space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void supabase?.auth.getSession().then(async ({ data }) => {
            const token = data.session?.access_token;
            if (!token) {
              setStatus("Sign in again before sending.");
              return;
            }
            const response = await fetch("/.netlify/functions/whatsapp-send", {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ leadId, to, template }),
            });
            const body = (await response.json()) as { status?: string };
            setStatus(body.status ?? "request_failed");
          });
        }}>
          <input value={leadId} onChange={(event) => setLeadId(event.target.value)} required placeholder="Lead id" className="w-full rounded-md border border-line px-2 py-2" />
          <input value={to} onChange={(event) => setTo(event.target.value)} required placeholder="Phone" className="w-full rounded-md border border-line px-2 py-2" />
          <input value={template} onChange={(event) => setTemplate(event.target.value)} required placeholder="Approved template name" className="w-full rounded-md border border-line px-2 py-2" />
          <button className="rounded-md bg-navy px-3 py-2 text-sm text-white" type="submit">Send template</button>
        </form>
      ) : null}
      {status ? <p className="text-sm">{status}</p> : null}
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Messages you are allowed to see</h2>
        {messages.length === 0 ? <p className="mt-2 text-sm text-muted">No messages yet.</p> : messages.map((item) => (
          <p key={item.id} className="mt-2 text-sm">{item.created_at} · {item.direction} · {item.status} · {item.body}</p>
        ))}
      </section>
    </div>
  );
}

function DemoWhatsApp() {
  const { session } = useAuth();
  const { state, sendWhatsApp, broadcastWhatsApp, simulateReply, markRead, createFollowUps } = useCrm();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [templateId, setTemplateId] = useState("");
  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [message, setMessage] = useState("Hi {{name}}, this is a follow-up from {{company}} about {{position}}. Reply here and we will confirm the next step.");
  const [posterName, setPosterName] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [when, setWhen] = useState(toDateTimeLocal(tomorrowAt10()));
  const me = state.users.find((user) => user.id === session?.userId);
  const matched = useMemo(() => {
    return deskLeads(state.leads, me).filter((lead) => inDayRange(lead.createdAt, from || null, to || null));
  }, [from, me, state.leads, to]);
  const targets = matched.slice(0, SEND_LIMIT);

  const conversations = useMemo(() => {
    return [...state.conversations].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }, [state.conversations]);
  const requested = params.get("lead");
  const activeId = requested && conversations.some((item) => item.leadId === requested) ? requested : conversations[0]?.leadId ?? "";
  const lead = state.leads.find((item) => item.id === activeId);
  const conversation = conversations.find((item) => item.leadId === activeId);
  const messages = state.messages.filter((item) => item.leadId === activeId).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  useEffect(() => {
    if (activeId) markRead(activeId);
    // The open thread is marked read once per candidate. markRead always reads the latest store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const compose = (person: Lead) => {
    const text = renderTemplate(message, person, state.settings, userName(state.users, person.assignedTo)).trim();
    return posterName ? `${text}\nPoster: ${posterName}` : text;
  };

  const sendToLeads = () => {
    if (!message.trim() || targets.length === 0) return;
    const sent = broadcastWhatsApp(targets.map((person) => ({ leadId: person.id, body: compose(person) })));
    if (sent > 0) setParams({ lead: targets[0].id });
  };

  const scheduleFollowUp = () => {
    if (!message.trim() || !when || targets.length === 0) return;
    const note = posterName ? `${message.trim()}\nPoster: ${posterName}` : message.trim();
    createFollowUps(targets.map((person) => person.id), "whatsapp", new Date(when).toISOString(), note);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="WhatsApp" description="Demo Mode — WhatsApp API not connected. Messages stay in this prototype." />
      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">One message, one poster</h2>
          <p className="mt-1 text-sm text-muted">Filter leads from one date to another, customize the message, attach a single poster, then send or schedule the follow-up. Clinic welcome can still send itself. Institute messages go only when you press send.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <label className="text-xs text-muted">
            From
            <Input className="mt-1" type="date" aria-label="Leads from" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="text-xs text-muted">
            To
            <Input className="mt-1" type="date" aria-label="Leads to" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="text-xs text-muted md:col-span-2">
            Follow-up time
            <Input className="mt-1" type="datetime-local" aria-label="Follow-up time" value={when} onChange={(event) => setWhen(event.target.value)} />
          </label>
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          aria-label="Follow-up message"
          className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-navy"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm">
            <ImagePlus className="size-4" />
            {posterName || "Add one poster"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setPosterName(file.name);
                setPosterUrl(URL.createObjectURL(file));
              }}
            />
          </label>
          {posterUrl ? <img src={posterUrl} alt="" className="h-14 w-14 rounded-md border border-line object-cover" /> : null}
          <Button type="button" disabled={!message.trim() || targets.length === 0} onClick={sendToLeads}>Send to these leads</Button>
          <Button type="button" variant="secondary" disabled={!message.trim() || !when || targets.length === 0} onClick={scheduleFollowUp}>Schedule follow-up</Button>
        </div>
        <p className="text-sm text-muted">
          {matched.length === 0
            ? "No leads were created in this date range."
            : `${matched.length.toLocaleString("en-IN")} leads in this range${matched.length > SEND_LIMIT ? `. This demo uses the first ${SEND_LIMIT}` : ""}. ${targets.map((person) => person.fullName.split(" ")[0]).slice(0, 6).join(", ")}${targets.length > 6 ? "…" : ""}`}
        </p>
      </Card>
      <div className="grid h-[calc(100dvh-220px)] min-h-[520px] overflow-hidden rounded-lg border border-line bg-white lg:grid-cols-[300px_1fr]">
        <aside className="overflow-y-auto border-b border-line lg:border-r lg:border-b-0">
          {conversations.map((item) => {
            const person = state.leads.find((entry) => entry.id === item.leadId);
            const last = [...state.messages].reverse().find((entry) => entry.conversationId === item.id);
            return (
              <button key={item.id} type="button" onClick={() => setParams({ lead: item.leadId })} className={cn("flex w-full flex-col gap-1 border-b border-line px-3 py-3 text-left hover:bg-slate-50", item.leadId === activeId && "bg-slate-50")}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{person?.fullName ?? "Candidate"}</span>
                  <span className="text-[11px] text-muted">{formatTime(item.updatedAt)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted">{last?.body ?? "No messages"}</span>
                  {item.unread ? <span className="rounded-full bg-navy px-1.5 text-[10px] text-white">{item.unread}</span> : <span className="text-[10px] text-slate-400">{person?.status.replaceAll("_", " ")}</span>}
                </span>
              </button>
            );
          })}
        </aside>
        <section className="flex min-h-0 flex-col">
          {lead ? (
            <>
              <header className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{lead.fullName}</p>
                  <p className="text-xs text-muted">{conversation?.unread ? "New reply" : "Last seen recently · Demo"}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => simulateReply(lead.id)}>Simulate reply</Button>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto bg-canvas px-4 py-4">
                {messages.map((entry) => (
                  <div key={entry.id} className={cn("max-w-[75%] rounded-lg px-3 py-2 text-sm", entry.direction === "out" ? "ml-auto bg-navy text-white" : "bg-white border border-line")}>
                    <MessageBody body={entry.body} />
                    <p className={cn("mt-1 text-[11px]", entry.direction === "out" ? "text-slate-300" : "text-muted")}>
                      {formatTime(entry.createdAt)} · {entry.status === "failed" ? "Failed" : "Demo"}
                    </p>
                  </div>
                ))}
              </div>
              <form
                className="border-t border-line p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const template = state.templates.find((item) => item.id === templateId);
                  const body = template ? renderTemplate(template.body, lead, state.settings, userName(state.users, lead.assignedTo)) : draft;
                  if (sendWhatsApp({ leadId: lead.id, body, templateId: template?.id })) setDraft("");
                }}
              >
                <div className="mb-2 flex gap-2">
                  <Select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                    <option value="">Template</option>
                    {state.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </Select>
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-xs text-muted">
                    <Paperclip className="size-3.5" /> Attachment
                    <input type="file" className="hidden" onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file || !lead) return;
                      sendWhatsApp({ leadId: lead.id, body: `Attachment: ${file.name} (demo — not uploaded)` });
                    }} />
                  </label>
                </div>
                <div className="flex gap-2">
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message..." className="h-10 flex-1 rounded-md border border-line px-3 text-sm outline-none focus:border-navy" />
                  <Button type="submit">Send</Button>
                </div>
              </form>
            </>
          ) : <p className="p-6 text-sm text-muted">No conversations yet.</p>}
        </section>
      </div>
    </div>
  );
}

function MessageBody({ body }: { body: string }) {
  const poster = body.split("\n").find((line) => line.startsWith("Poster: "));
  const text = body.split("\n").filter((line) => !line.startsWith("Poster: ")).join("\n").trim();
  return (
    <>
      {poster ? <p className="mb-2 rounded-md border border-current/20 px-2 py-1 text-xs">Poster · {poster.slice("Poster: ".length)}</p> : null}
      <p className="whitespace-pre-wrap">{text}</p>
    </>
  );
}
