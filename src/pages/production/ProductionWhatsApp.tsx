import { format } from "date-fns";
import { ImagePlus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp, canWriteWhatsApp, whatsAppDesk } from "@/lib/production-access";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import {
  listWhatsAppChats,
  listWhatsAppNumbers,
  listWhatsAppPosters,
  listWhatsAppThread,
  saveWhatsAppPoster,
  sendWhatsAppBulk,
  sendWhatsAppMessage,
  type WhatsAppBubble,
  type WhatsAppChat,
  type WhatsAppNumber,
  type WhatsAppPoster,
} from "@/services/whatsapp-desk";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function outgoing(direction: string) {
  return direction === "outbound" || direction === "out";
}

const QUICK_REPLIES = [
  { label: "Welcome", text: "Hello, this is Dr. K's Aesthetic Clinic. Thank you for messaging us. How can we help you today?" },
  { label: "Follow-up", text: "Hello, this is a follow-up from Dr. K's Aesthetic Clinic on +91 95624 29928. Reply here and our team will assist you." },
  { label: "Appointment", text: "Hello, this is Dr. K's Aesthetic Clinic. Reply to this message to confirm or change your appointment." },
];

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
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [bulkText, setBulkText] = useState("");
  const [bulkPosterId, setBulkPosterId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [chatReload, setChatReload] = useState(0);
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<"chat" | "bulk">("chat");
  const [bulkRunning, setBulkRunning] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const visibleDesks = useMemo(() => workspaces.filter((item) => deskMode === "both" || item.workspaceType === deskMode), [deskMode, workspaces]);
  const desk = visibleDesks.find((item) => item.id === deskId) ?? visibleDesks[0];
  const active = chats.find((item) => item.id === activeId) ?? null;

  useEffect(() => {
    void listWorkspaces().then(setWorkspaces).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not load WhatsApp"));
    void listWhatsAppNumbers().then(setNumbers).catch(() => setNumbers([]));
  }, []);

  useEffect(() => {
    if (!desk && !admin && visibleDesks[0]) setDeskId(visibleDesks[0].id);
    if (admin && !deskId) setDeskId("all");
  }, [desk, visibleDesks]);

  useEffect(() => {
    const workspaceId = !admin || deskId !== "all" ? desk?.id ?? "" : "";
    if (!admin && !desk) return;
    void listWhatsAppChats(workspaceId, search, admin ? "all" : "clicks", page)
      .then((result) => {
        setChats(result.chats);
        setChatTotal(result.total);
        setActiveId((current) => {
          if (result.chats.some((item) => item.id === current)) return current;
          const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
          return wide ? result.chats[0]?.id ?? "" : "";
        });
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not load chats"));
    const posterDesk = desk ?? visibleDesks[0];
    if (posterDesk) void listWhatsAppPosters(posterDesk.id).then(setPosters).catch(() => setPosters([]));
  }, [admin, desk, deskId, page, search, chatReload]);

  useEffect(() => {
    const onLead = () => setChatReload((value) => value + 1);
    window.addEventListener("bitvion-lead", onLead);
    window.addEventListener("bitvion-lead-update", onLead);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") onLead();
    }, 5000);
    return () => {
      window.removeEventListener("bitvion-lead", onLead);
      window.removeEventListener("bitvion-lead-update", onLead);
      window.clearInterval(timer);
    };
  }, []);

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

  const sendingNumber = numbers.find((item) => item.displayPhone.replace(/\D/g, "").endsWith("9562429928"))
    ?? numbers.find((item) => item.workspaceType === "clinic");
  const posterDesk = visibleDesks.find((item) => item.id === sendingNumber?.workspaceId)
    ?? visibleDesks.find((item) => item.workspaceType === "clinic")
    ?? desk;
  const fromLine = sendingNumber?.displayPhone || "+91 95624 29928";

  const sendDirect = () => {
    if (!active?.phone) return;
    const poster = posters.find((item) => item.id === posterId);
    setBusy("send");
    void sendWhatsAppMessage({ leadId: active.id, to: active.phone, text: draft.trim(), bulkSize: 1, imageUrl: poster?.url })
      .then((status) => {
        setNotice(status === "sent" ? `Sent from ${fromLine}.` : status);
        if (status === "sent") setDraft("");
        return listWhatsAppThread(active.id);
      })
      .then(setThread)
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not send"))
      .finally(() => setBusy(""));
  };

  const sendBulk = () => {
    const poster = posters.find((item) => item.id === bulkPosterId);
    const bulkDesk = admin && deskId === "all" ? undefined : desk?.id;
    if (!bulkDesk && !admin) return;
    if (!window.confirm(`Send this WhatsApp from ${fromLine} to ${chatTotal.toLocaleString("en-IN")} leads?`)) return;
    setBulkRunning(true);
    const run = async () => {
      let offset = 0;
      let sent = 0;
      let failed = 0;
      for (let step = 0; step < 800; step += 1) {
        const batch = await sendWhatsAppBulk({ text: bulkText.trim(), imageUrl: poster?.url || "", workspaceId: bulkDesk, offset });
        sent += batch.sent;
        failed += batch.failed;
        setNotice(`From ${fromLine}: sent ${sent.toLocaleString("en-IN")} · failed ${failed.toLocaleString("en-IN")} of ${batch.total.toLocaleString("en-IN")}`);
        if (batch.done || batch.sent === 0) break;
        offset = batch.next;
      }
    };
    void run().catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Bulk send stopped")).finally(() => setBulkRunning(false));
  };

  const chip = (on: boolean) => cn("rounded-full px-3 py-1 text-xs font-medium", on ? "bg-[#d9fdd3] text-[#008069]" : "bg-[#f0f2f5] text-[#54656f]");

  return (
    <div className="-mx-3 -mt-4 mb-[-6rem] bg-[#d1d7db] sm:-mx-6 lg:-mx-8 lg:mb-0 lg:h-[calc(100dvh-4.25rem)]">
      {notice ? <p className="bg-[#d9fdd3] px-4 py-2 text-center text-xs text-[#111b21]">{notice}</p> : null}
      <div className={cn("mx-auto grid h-[calc(100dvh-8.5rem)] max-w-[1600px] overflow-hidden bg-white shadow-sm lg:h-full lg:grid-cols-[400px_1fr]")}>
        <aside className={cn("flex min-h-0 flex-col border-[#e9edef] lg:border-r", (activeId || panel === "bulk") && "max-lg:hidden")}>
          <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3">
            <div>
              <p className="text-[15px] font-semibold text-[#111b21]">WhatsApp</p>
              <p className="text-xs text-[#667781]">{fromLine}</p>
            </div>
            <span className="rounded-full bg-[#25D366] px-2 py-1 text-[11px] font-semibold text-white">{chatTotal.toLocaleString("en-IN")}</span>
          </header>
          {write ? (
            <div className="flex gap-2 overflow-x-auto bg-white px-3 py-2">
              <button type="button" onClick={() => { setPanel("chat"); if (admin) setDeskId("all"); setPage(1); }} className={chip(panel === "chat" && (deskId === "all" || !admin))}>All</button>
              <button type="button" onClick={() => { setPanel("bulk"); setActiveId(""); }} className={chip(panel === "bulk")}>Bulk</button>
              {deskMode === "both" ? visibleDesks.map((item) => (
                <button key={item.id} type="button" onClick={() => { setPanel("chat"); setDeskId(item.id); setPage(1); }} className={chip(panel === "chat" && item.id === desk?.id && deskId !== "all")}>
                  {item.workspaceType === "clinic" ? "Clinic" : "Institute"}
                </button>
              )) : null}
            </div>
          ) : null}
          <label className="px-3 pb-2">
            <span className="flex items-center gap-3 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm text-[#54656f]">
              <Search className="size-4" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search or start a new chat" className="w-full bg-transparent text-[#111b21] outline-none placeholder:text-[#667781]" />
            </span>
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white">
            {chats.map((chat) => (
              <button key={chat.id} type="button" onClick={() => { setPanel("chat"); setActiveId(chat.id); }} className={cn("flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#f5f6f6]", panel === "chat" && chat.id === activeId && "bg-[#f0f2f5]")}>
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-medium text-[#54656f]">{initials(chat.fullName)}</span>
                <span className="min-w-0 flex-1 border-b border-[#e9edef] pb-3">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[17px] text-[#111b21]">{chat.fullName}</span>
                    <span className="shrink-0 text-xs text-[#667781]">{format(new Date(chat.createdAt), "dd/MM/yyyy")}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-[#667781]">{chat.preview || chat.phone}</span>
                </span>
              </button>
            ))}
            {chats.length === 0 ? <p className="px-3 py-6 text-sm text-[#667781]">No chats on {fromLine}.</p> : null}
            {chatTotal > chats.length ? (
              <div className="flex items-center justify-between px-3 py-2 text-xs text-[#667781]">
                <span>{chats.length} of {chatTotal.toLocaleString("en-IN")}</span>
                <span className="flex gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
                  <button type="button" disabled={page * 20 >= chatTotal} onClick={() => setPage((value) => value + 1)}>Next</button>
                </span>
              </div>
            ) : null}
          </div>
        </aside>
        <section className={cn("wa-wallpaper flex min-h-0 flex-col", !activeId && panel !== "bulk" && "max-lg:hidden")}>
          {write && panel === "bulk" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <header className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-2.5">
                <button type="button" className="rounded-md px-2 py-2 text-sm font-medium text-[#075E54] lg:hidden" onClick={() => setPanel("chat")}>Back</button>
                <span className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Bulk message</p>
                  <p className="text-xs text-[#667781]">From {fromLine} · {chatTotal.toLocaleString("en-IN")} leads</p>
                </span>
                {posterDesk ? (
                  <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 text-sm">
                    <ImagePlus className="size-4" /> Poster
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setBusy("poster");
                        void saveWhatsAppPoster(posterDesk, file)
                          .then(() => listWhatsAppPosters(posterDesk.id))
                          .then(setPosters)
                          .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not save the poster"))
                          .finally(() => setBusy(""));
                      }}
                    />
                  </label>
                ) : null}
              </header>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="flex flex-wrap gap-2">
                  {QUICK_REPLIES.map((reply) => (
                    <button key={reply.label} type="button" className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#075E54] shadow-sm" onClick={() => setBulkText(reply.text)}>{reply.label}</button>
                  ))}
                </div>
                <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={5} placeholder="Type a message" className="w-full rounded-lg bg-white px-3 py-2 text-[15px] text-[#111b21] outline-none" />
                <select value={bulkPosterId} onChange={(event) => setBulkPosterId(event.target.value)} className="h-10 rounded-md border border-line bg-white px-2 text-sm">
                  <option value="">No poster</option>
                  {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
                </select>
                {posters.find((poster) => poster.id === bulkPosterId)?.url ? <img src={posters.find((poster) => poster.id === bulkPosterId)?.url} alt="" className="max-h-48 rounded-lg border border-line object-contain" /> : null}
              </div>
              <div className="flex items-center gap-2 bg-[#f0f2f5] px-4 py-2">
                <button type="button" className="ml-auto flex size-11 items-center justify-center rounded-full bg-[#00a884] text-sm font-medium text-white disabled:opacity-60" disabled={bulkRunning || (!bulkText.trim() && !bulkPosterId)} onClick={sendBulk}>
                  {bulkRunning ? "…" : "Send"}
                </button>
              </div>
            </div>
          ) : active ? (
            <>
              <header className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-2">
                <button type="button" className="text-xl text-[#54656f] lg:hidden" onClick={() => setActiveId("")} aria-label="Back">‹</button>
                <span className="flex size-10 items-center justify-center rounded-full bg-[#dfe5e7] text-sm text-[#54656f]">{initials(active.fullName)}</span>
                <span className="min-w-0 flex-1">
                  <p className="truncate text-[16px] text-[#111b21]">{active.fullName}</p>
                  <p className="truncate text-xs text-[#667781]">{active.phone}</p>
                </span>
              </header>
              <div className="flex-1 space-y-1.5 overflow-y-auto px-[6%] py-4">
                {thread.length === 0 ? <p className="mx-auto w-fit rounded-lg bg-[#ffeecd] px-3 py-1.5 text-center text-xs text-[#54656f] shadow-sm">Messages in this chat appear here. Sending from {fromLine}.</p> : null}
                {thread.map((entry) => (
                  <div key={entry.id} className={cn("relative max-w-[65%] px-2 py-1.5 text-[14.2px] leading-snug text-[#111b21] shadow-sm", outgoing(entry.direction) ? "ml-auto rounded-lg rounded-tr-none bg-[#d9fdd3]" : "rounded-lg rounded-tl-none bg-white")}>
                    <MessageBody body={entry.body} />
                    <p className="mt-0.5 text-right text-[11px] text-[#667781]">{format(new Date(entry.createdAt), "h:mm a")}</p>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {write ? (
                <form
                  className="bg-[#f0f2f5] px-3 py-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendDirect();
                  }}
                >
                  <div className="mb-2 flex gap-2 overflow-x-auto">
                    {QUICK_REPLIES.map((reply) => (
                      <button key={reply.label} type="button" className="shrink-0 rounded-full bg-white px-3 py-1 text-xs text-[#008069] shadow-sm" onClick={() => setDraft(reply.text)}>{reply.label}</button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <select value={posterId} onChange={(event) => setPosterId(event.target.value)} aria-label="Poster" className="h-11 rounded-full bg-white px-3 text-xs text-[#54656f] outline-none">
                      <option value="">Poster</option>
                      {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
                    </select>
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message" className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-[15px] text-[#111b21] outline-none" />
                    {active.phone ? (
                      <button type="submit" aria-label="Send" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white disabled:opacity-60">
                        {busy === "send" ? "…" : "➤"}
                      </button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </>
          ) : (
            <div className="m-auto max-w-md px-8 text-center">
              <p className="text-[32px] font-light text-[#41525d]">WhatsApp</p>
              <p className="mt-3 text-sm text-[#667781]">Send and receive messages from {fromLine}. {chatTotal.toLocaleString("en-IN")} leads are in this list.</p>
            </div>
          )}
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
