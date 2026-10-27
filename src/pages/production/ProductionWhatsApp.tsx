import { format } from "date-fns";
import { ImagePlus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WhatsAppLink } from "@/components/shared/WhatsAppLink";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp, canWriteWhatsApp, whatsAppDesk } from "@/lib/production-access";
import { whatsAppHref } from "@/lib/phone";
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

  const messageText = (text: string, selectedPoster: string) => {
    const poster = posters.find((item) => item.id === selectedPoster);
    return poster ? `${text.trim()}\nPoster: ${poster.filename}` : text.trim();
  };

  const openText = messageText(draft || bulkText, posterId || bulkPosterId);
  const openHref = active ? whatsAppHref(active.phone, openText) : "";
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
    if (!window.confirm(`Send this WhatsApp from ${fromLine} to ${chatTotal.toLocaleString("en-IN")} leads?`)) return;
    setBulkRunning(true);
    const run = async () => {
      let offset = 0;
      let sent = 0;
      let failed = 0;
      for (let step = 0; step < 800; step += 1) {
        const batch = await sendWhatsAppBulk({ text: bulkText.trim(), imageUrl: poster?.url || "", workspaceId: deskId === "all" ? undefined : desk?.id, offset });
        sent += batch.sent;
        failed += batch.failed;
        setNotice(`From ${fromLine}: sent ${sent.toLocaleString("en-IN")} · failed ${failed.toLocaleString("en-IN")} of ${batch.total.toLocaleString("en-IN")}`);
        if (batch.done || batch.sent === 0) break;
        offset = batch.next;
      }
    };
    void run().catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Bulk send stopped")).finally(() => setBulkRunning(false));
  };

  return (
    <div className="space-y-3">
      {notice ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">{notice}</p> : null}
      <div className={cn("grid overflow-hidden rounded-lg border border-[#d1d7db] bg-white max-lg:min-h-[70dvh] lg:h-[calc(100dvh-120px)] lg:min-h-[560px] lg:grid-cols-[320px_1fr]")}>
        <aside className={cn("flex min-h-0 flex-col border-b border-[#d1d7db] lg:border-r lg:border-b-0", (activeId || panel === "bulk") && "max-lg:hidden")}>
          <header className="bg-[#075E54] px-3 py-3 text-white">
            <p className="text-sm font-semibold">WhatsApp</p>
            <p className="text-[11px] text-white/80">{admin ? fromLine : desk?.name}</p>
            {deskMode === "both" ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {admin ? (
                  <>
                    <button type="button" onClick={() => { setPanel("chat"); setDeskId("all"); setPage(1); }} className={cn("rounded-full px-2 py-1 text-[11px]", panel === "chat" && deskId === "all" ? "bg-white text-[#075E54]" : "bg-white/15")}>Chats</button>
                    <button type="button" onClick={() => { setPanel("bulk"); setActiveId(""); }} className={cn("rounded-full px-2 py-1 text-[11px]", panel === "bulk" ? "bg-white text-[#075E54]" : "bg-white/15")}>Bulk</button>
                  </>
                ) : null}
                {visibleDesks.map((item) => (
                  <button key={item.id} type="button" onClick={() => { setPanel("chat"); setDeskId(item.id); setPage(1); }} className={cn("rounded-full px-2 py-1 text-[11px]", panel === "chat" && item.id === desk?.id && deskId !== "all" ? "bg-white text-[#075E54]" : "bg-white/15")}>
                    {item.workspaceType === "clinic" ? "Clinic" : "Institute"}
                  </button>
                ))}
              </div>
            ) : null}
          </header>
          <label className="flex items-center gap-2 border-b border-[#d1d7db] px-3 py-2 text-sm text-muted">
            <Search className="size-4" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name or phone" className="w-full bg-transparent outline-none" />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chats.map((chat) => (
              <div key={chat.id} className={cn("flex items-center gap-2 border-b border-[#f0f2f5] pr-2 hover:bg-[#f5f6f6]", panel === "chat" && chat.id === activeId && "bg-[#f0f2f5]")}>
                <button type="button" onClick={() => { setPanel("chat"); setActiveId(chat.id); }} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-xs font-semibold text-[#54656f]">{initials(chat.fullName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{chat.fullName}</span>
                      <span className="text-[11px] text-[#667781]">{format(new Date(chat.createdAt), "dd/MM")}</span>
                    </span>
                    <span className="block truncate text-xs text-[#667781]">{chat.phone}</span>
                    {chat.preview ? <span className="block truncate text-xs text-[#667781]">{chat.preview}</span> : null}
                  </span>
                </button>
                {write && !admin ? <WhatsAppLink phone={chat.phone} text={messageText(bulkText, bulkPosterId)} label={`Open WhatsApp for ${chat.fullName}`} /> : null}
              </div>
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
        <section className={cn("flex min-h-[70dvh] flex-col bg-[#efeae2] lg:min-h-0", !activeId && panel !== "bulk" && "max-lg:hidden")}>
          {admin && panel === "bulk" ? (
            <div className="flex min-h-0 flex-1 flex-col bg-[#efeae2]">
              <header className="flex items-center gap-3 bg-[#f0f2f5] px-3 py-3">
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
                <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={5} placeholder="Message" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-[#075E54]" />
                <select value={bulkPosterId} onChange={(event) => setBulkPosterId(event.target.value)} className="h-10 rounded-md border border-line bg-white px-2 text-sm">
                  <option value="">No poster</option>
                  {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
                </select>
                {posters.find((poster) => poster.id === bulkPosterId)?.url ? <img src={posters.find((poster) => poster.id === bulkPosterId)?.url} alt="" className="max-h-48 rounded-lg border border-line object-contain" /> : null}
              </div>
              <div className="bg-[#f0f2f5] p-3">
                <button type="button" className="h-10 rounded-md bg-[#075E54] px-4 text-sm font-medium text-white disabled:opacity-60" disabled={bulkRunning || (!bulkText.trim() && !bulkPosterId)} onClick={sendBulk}>
                  {bulkRunning ? "Sending…" : "Send bulk"}
                </button>
              </div>
            </div>
          ) : active ? (
            <>
              <header className="flex items-center gap-3 bg-[#f0f2f5] px-3 py-3">
                <button type="button" className="rounded-md px-2 py-2 text-sm font-medium text-[#075E54] lg:hidden" onClick={() => setActiveId("")}>Back</button>
                <span className="flex size-9 items-center justify-center rounded-full bg-[#dfe5e7] text-xs font-semibold">{initials(active.fullName)}</span>
                <span className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{active.fullName}</p>
                  <p className="text-xs text-[#667781]">{active.phone}{admin ? ` · from ${fromLine}` : ""}</p>
                </span>
                {write && !admin ? <WhatsAppLink phone={active.phone} text={openText} label={`Open WhatsApp for ${active.fullName}`} /> : null}
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
                  className="flex flex-col gap-2 bg-[#f0f2f5] p-3 sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (admin) sendDirect();
                  }}
                >
                  <select value={posterId} onChange={(event) => setPosterId(event.target.value)} className="h-10 rounded-md border border-line bg-white px-2 text-xs">
                    <option value="">Poster</option>
                    {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
                  </select>
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={admin ? "Message" : "Message to open in WhatsApp"} className="h-10 flex-1 rounded-md border border-line px-3 text-sm outline-none" />
                  {admin && active.phone ? (
                    <button type="submit" className="inline-flex h-11 items-center justify-center rounded-md bg-[#075E54] px-3 text-sm font-medium text-white sm:h-10">
                      {busy === "send" ? "Sending…" : "Send"}
                    </button>
                  ) : null}
                  {!admin && openHref ? (
                    <a href={openHref} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#25D366] px-3 text-sm font-medium text-white hover:bg-[#1ebe5d] sm:h-10">Open WhatsApp</a>
                  ) : null}
                  {!active.phone ? <span className="text-xs text-muted">This lead has no phone number.</span> : null}
                </form>
              ) : null}
            </>
          ) : <p className="m-auto text-sm text-[#667781]">Select a chat{admin ? " or open Bulk" : ""}.</p>}
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
