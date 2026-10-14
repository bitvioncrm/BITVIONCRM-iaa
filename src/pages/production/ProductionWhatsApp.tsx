import { format } from "date-fns";
import { ImagePlus, Search, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp, canSendBulk, canWriteWhatsApp, WHATSAPP_BULK_ADMIN_LIMIT, whatsAppDesk } from "@/lib/production-access";
import { listLeads, listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import {
  countWhatsAppRecipients,
  dayStart,
  listWhatsAppChats,
  listWhatsAppPosters,
  listWhatsAppThread,
  nextDayStart,
  saveWhatsAppPoster,
  sendWhatsAppMessage,
  type WhatsAppBubble,
  type WhatsAppChat,
  type WhatsAppPoster,
} from "@/services/whatsapp-desk";
import { cn } from "@/lib/utils";

function failure(status: string) {
  if (status === "sent") return "";
  if (status === "configuration_required") return "This WhatsApp number is not connected yet. Nothing was sent.";
  if (status === "bulk_admin_only") return "More than 50 messages can only be sent by Admin.";
  if (status === "provider_rejected") return "WhatsApp did not accept the message.";
  if (status === "forbidden") return "This chat belongs to the other WhatsApp number.";
  return "The message was not sent.";
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function outgoing(direction: string) {
  return direction === "outbound" || direction === "out";
}

export function ProductionWhatsApp() {
  const { productionUser } = useAuth();
  const role = productionUser?.roleKey ?? "";
  const write = canWriteWhatsApp(role);
  const admin = canOperateWhatsApp(role);
  const deskMode = whatsAppDesk(role);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [deskId, setDeskId] = useState("");
  const [search, setSearch] = useState("");
  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [chatTotal, setChatTotal] = useState(0);
  const [activeId, setActiveId] = useState("");
  const [thread, setThread] = useState<WhatsAppBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [posterId, setPosterId] = useState("");
  const [posters, setPosters] = useState<WhatsAppPoster[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bulkName, setBulkName] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkPosterId, setBulkPosterId] = useState("");
  const [bulkTotal, setBulkTotal] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const visibleDesks = useMemo(() => workspaces.filter((item) => deskMode === "both" || item.workspaceType === deskMode), [deskMode, workspaces]);
  const desk = visibleDesks.find((item) => item.id === deskId) ?? visibleDesks[0];
  const active = chats.find((item) => item.id === activeId) ?? null;

  useEffect(() => {
    void listWorkspaces().then(setWorkspaces).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not load WhatsApp"));
  }, []);

  useEffect(() => {
    if (!desk && visibleDesks[0]) setDeskId(visibleDesks[0].id);
  }, [desk, visibleDesks]);

  useEffect(() => {
    if (!desk) return;
    void listWhatsAppChats(desk.id, search)
      .then((result) => {
        setChats(result.chats);
        setChatTotal(result.total);
        setActiveId((current) => result.chats.some((item) => item.id === current) ? current : result.chats[0]?.id ?? "");
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not load chats"));
    void listWhatsAppPosters(desk.id).then(setPosters).catch(() => setPosters([]));
  }, [desk, search]);

  useEffect(() => {
    if (!activeId) {
      setThread([]);
      return;
    }
    void listWhatsAppThread(activeId).then(setThread).catch(() => setThread([]));
  }, [activeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread]);

  useEffect(() => {
    if (!desk) return;
    void countWhatsAppRecipients(desk.id, { from, to, name: bulkName }).then((result) => setBulkTotal(result.total)).catch(() => setBulkTotal(0));
  }, [bulkName, desk, from, to]);

  const messageText = (text: string, selectedPoster: string) => {
    const poster = posters.find((item) => item.id === selectedPoster);
    return poster ? `${text.trim()}\nPoster: ${poster.filename}` : text.trim();
  };

  const deliver = async (leadId: string, phone: string, text: string, bulkSize: number) => {
    const status = await sendWhatsAppMessage({ leadId, to: phone, text, bulkSize });
    const problem = failure(status);
    if (problem) throw new Error(problem);
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-line bg-white p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Bulk message</h2>
            <p className="mt-1 text-xs text-muted">Filter by date and name on {desk?.name ?? "this number"}. More than {WHATSAPP_BULK_ADMIN_LIMIT} people can only be sent by Admin.</p>
          </div>
          {admin && desk ? (
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm">
              <ImagePlus className="size-4" /> Add poster
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || !desk) return;
                  setBusy("poster");
                  void saveWhatsAppPoster(desk, file)
                    .then(() => listWhatsAppPosters(desk.id))
                    .then(setPosters)
                    .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not save the poster"))
                    .finally(() => setBusy(""));
                }}
              />
            </label>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <label className="text-xs text-muted">From<Input className="mt-1" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="text-xs text-muted">To<Input className="mt-1" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label className="text-xs text-muted md:col-span-2">Name<Input className="mt-1" placeholder="Search name or phone" value={bulkName} onChange={(event) => setBulkName(event.target.value)} /></label>
        </div>
        <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={2} placeholder="Message" className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-[#075E54]" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={bulkPosterId} onChange={(event) => setBulkPosterId(event.target.value)} className="h-9 rounded-md border border-line bg-white px-2 text-sm">
            <option value="">No poster</option>
            {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
          </select>
          <Button
            type="button"
            disabled={!write || !bulkText.trim() || bulkTotal < 1 || busy === "bulk" || !canSendBulk(role, bulkTotal)}
            onClick={() => {
              if (!desk || !canSendBulk(role, bulkTotal)) return;
              if (!window.confirm(`Send this message to ${bulkTotal.toLocaleString("en-IN")} people on ${desk.name}?`)) return;
              setBusy("bulk");
              setNotice("");
              void (async () => {
                let sent = 0;
                const filters = {
                  workspaceId: desk.id,
                  search: bulkName,
                  createdFrom: from ? dayStart(from) : undefined,
                  createdTo: to ? nextDayStart(to) : undefined,
                };
                const first = await listLeads({ page: 1, ...filters });
                for (let page = 1; page <= first.pages; page += 1) {
                  const batch = page === 1 ? first : await listLeads({ page, ...filters });
                  for (const lead of batch.leads) {
                    await deliver(lead.id, lead.phone, messageText(bulkText, bulkPosterId), bulkTotal);
                    sent += 1;
                    setNotice(`Sent ${sent.toLocaleString("en-IN")} of ${bulkTotal.toLocaleString("en-IN")}.`);
                  }
                }
                setNotice(`Sent ${sent.toLocaleString("en-IN")} messages on ${desk.name}.`);
                if (activeId) setThread(await listWhatsAppThread(activeId));
              })().catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "The bulk message stopped.")).finally(() => setBusy(""));
            }}
          >
            {busy === "bulk" ? "Sending…" : `Send to ${bulkTotal.toLocaleString("en-IN")}`}
          </Button>
          {!canSendBulk(role, bulkTotal) && bulkTotal > WHATSAPP_BULK_ADMIN_LIMIT ? <p className="text-xs text-muted">Ask Admin to send this. It is more than {WHATSAPP_BULK_ADMIN_LIMIT} people.</p> : null}
        </div>
      </section>
      {notice ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">{notice}</p> : null}
      <div className="grid h-[calc(100dvh-280px)] min-h-[520px] overflow-hidden rounded-lg border border-[#d1d7db] bg-white lg:grid-cols-[320px_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-[#d1d7db] lg:border-r lg:border-b-0">
          <header className="bg-[#075E54] px-3 py-3 text-white">
            <p className="text-sm font-semibold">WhatsApp</p>
            {deskMode === "both" ? (
              <div className="mt-2 flex gap-1">
                {visibleDesks.map((item) => (
                  <button key={item.id} type="button" onClick={() => setDeskId(item.id)} className={cn("rounded-full px-2 py-1 text-[11px]", item.id === desk?.id ? "bg-white text-[#075E54]" : "bg-white/15")}>
                    {item.workspaceType === "clinic" ? "Clinic" : "Institute"}
                  </button>
                ))}
              </div>
            ) : <p className="mt-1 text-[11px] text-white/80">{desk?.name}</p>}
          </header>
          <label className="flex items-center gap-2 border-b border-[#d1d7db] px-3 py-2 text-sm text-muted">
            <Search className="size-4" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone" className="w-full bg-transparent outline-none" />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chats.map((chat) => (
              <button key={chat.id} type="button" onClick={() => setActiveId(chat.id)} className={cn("flex w-full items-center gap-3 border-b border-[#f0f2f5] px-3 py-3 text-left hover:bg-[#f5f6f6]", chat.id === activeId && "bg-[#f0f2f5]")}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-xs font-semibold text-[#54656f]">{initials(chat.fullName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{chat.fullName}</span>
                    <span className="text-[11px] text-[#667781]">{format(new Date(chat.createdAt), "dd/MM")}</span>
                  </span>
                  <span className="block truncate text-xs text-[#667781]">{chat.preview || chat.phone}</span>
                </span>
              </button>
            ))}
            {chats.length === 0 ? <p className="px-3 py-6 text-sm text-[#667781]">No chats on this number.</p> : null}
            {chatTotal > chats.length ? <p className="px-3 py-2 text-xs text-[#667781]">Showing {chats.length} of {chatTotal.toLocaleString("en-IN")}. Search to open someone else.</p> : null}
          </div>
        </aside>
        <section className="flex min-h-0 flex-col bg-[#efeae2]">
          {active ? (
            <>
              <header className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-[#dfe5e7] text-xs font-semibold">{initials(active.fullName)}</span>
                <span>
                  <p className="text-sm font-semibold">{active.fullName}</p>
                  <p className="text-xs text-[#667781]">{active.phone} · {desk?.name}</p>
                </span>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
                {thread.length === 0 ? <p className="text-center text-xs text-[#667781]">No WhatsApp messages in this chat yet.</p> : null}
                {thread.map((entry) => (
                  <div key={entry.id} className={cn("max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm", outgoing(entry.direction) ? "ml-auto bg-[#d9fdd3]" : "bg-white")}>
                    <MessageBody body={entry.body} />
                    <p className="mt-1 text-right text-[11px] text-[#667781]">{format(new Date(entry.createdAt), "h:mm a")} · {entry.status}</p>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {write ? (
                <form
                  className="flex items-end gap-2 bg-[#f0f2f5] p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!draft.trim()) return;
                    const text = messageText(draft, posterId);
                    setBusy("chat");
                    void deliver(active.id, active.phone, text, 1)
                      .then(() => listWhatsAppThread(active.id))
                      .then((rows) => {
                        setThread(rows);
                        setDraft("");
                        setNotice("");
                      })
                      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "The message was not sent."))
                      .finally(() => setBusy(""));
                  }}
                >
                  <select value={posterId} onChange={(event) => setPosterId(event.target.value)} className="h-10 rounded-md border border-line bg-white px-2 text-xs">
                    <option value="">Poster</option>
                    {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
                  </select>
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message" className="h-10 flex-1 rounded-md border border-line px-3 text-sm outline-none" />
                  <Button type="submit" disabled={busy === "chat" || !draft.trim()} className="bg-[#075E54] hover:bg-[#064e46]"><Send className="size-4" /> Send</Button>
                </form>
              ) : <p className="bg-[#f0f2f5] px-4 py-3 text-xs text-[#667781]">You can read this WhatsApp. Sending is for the telecaller and Admin.</p>}
            </>
          ) : <p className="m-auto text-sm text-[#667781]">Select a chat.</p>}
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
      {poster ? <p className="mb-1 text-xs font-medium">Poster · {poster.slice("Poster: ".length)}</p> : null}
      <p className="whitespace-pre-wrap">{text || body}</p>
    </>
  );
}
