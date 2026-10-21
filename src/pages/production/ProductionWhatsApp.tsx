import { format } from "date-fns";
import { ImagePlus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WhatsAppLink } from "@/components/shared/WhatsAppLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp, canWriteWhatsApp, whatsAppDesk } from "@/lib/production-access";
import { whatsAppHref } from "@/lib/phone";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import {
  listWhatsAppChats,
  listWhatsAppNumbers,
  listWhatsAppPosters,
  listWhatsAppThread,
  saveWhatsAppNumber,
  saveWhatsAppPoster,
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
  const [phoneDraft, setPhoneDraft] = useState<Record<string, string>>({});
  const [bulkText, setBulkText] = useState("");
  const [bulkPosterId, setBulkPosterId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const visibleDesks = useMemo(() => workspaces.filter((item) => deskMode === "both" || item.workspaceType === deskMode), [deskMode, workspaces]);
  const desk = visibleDesks.find((item) => item.id === deskId) ?? visibleDesks[0];
  const active = chats.find((item) => item.id === activeId) ?? null;

  useEffect(() => {
    void listWorkspaces().then(setWorkspaces).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not load WhatsApp"));
    void listWhatsAppNumbers()
      .then((rows) => {
        setNumbers(rows);
        setPhoneDraft(Object.fromEntries(rows.map((item) => [item.workspaceId, item.displayPhone])));
      })
      .catch(() => setNumbers([]));
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

  const messageText = (text: string, selectedPoster: string) => {
    const poster = posters.find((item) => item.id === selectedPoster);
    return poster ? `${text.trim()}\nPoster: ${poster.filename}` : text.trim();
  };

  const openText = messageText(draft || bulkText, posterId || bulkPosterId);
  const openHref = active ? whatsAppHref(active.phone, openText) : "";
  const visibleNumbers = numbers.filter((item) => visibleDesks.some((deskItem) => deskItem.id === item.workspaceId));

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-line bg-white p-3">
        <h2 className="text-sm font-semibold">WhatsApp numbers</h2>
        <p className="mt-1 text-xs text-muted">The clinic and the institute keep separate numbers. A click opens that lead in WhatsApp. Nothing is sent from the CRM.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {visibleNumbers.map((item) => (
            <form
              key={item.workspaceId}
              className="flex flex-wrap items-end gap-2 rounded-md border border-line p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!admin) return;
                setBusy(item.workspaceId);
                void saveWhatsAppNumber(item.workspaceId, phoneDraft[item.workspaceId] ?? "")
                  .then(() => setNotice(`${item.workspaceType === "institute" ? "Institute" : "Clinic"} WhatsApp number saved.`))
                  .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not save the number"))
                  .finally(() => setBusy(""));
              }}
            >
              <label className="min-w-48 flex-1 text-xs text-muted">
                {item.workspaceType === "institute" ? "Institute" : "Clinic"} · {item.name}
                <Input
                  className="mt-1"
                  value={phoneDraft[item.workspaceId] ?? ""}
                  placeholder="+91…"
                  readOnly={!admin}
                  onChange={(event) => setPhoneDraft((current) => ({ ...current, [item.workspaceId]: event.target.value }))}
                />
              </label>
              {admin ? <Button type="submit" disabled={busy === item.workspaceId}>{busy === item.workspaceId ? "Saving…" : "Save number"}</Button> : null}
            </form>
          ))}
        </div>
      </section>
      {admin ? (
        <section className="rounded-lg border border-line bg-white p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Bulk posters</h2>
              <p className="mt-1 text-xs text-muted">Save a poster and a message for {desk?.name ?? "this desk"}. The WhatsApp logo on each lead opens that chat with the message ready.</p>
            </div>
            {desk ? (
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
          <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={2} placeholder="Message that opens with each lead" className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-[#075E54]" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <select value={bulkPosterId} onChange={(event) => setBulkPosterId(event.target.value)} className="h-9 rounded-md border border-line bg-white px-2 text-sm">
              <option value="">No poster</option>
              {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
            </select>
            {posters.find((poster) => poster.id === bulkPosterId)?.url ? <img src={posters.find((poster) => poster.id === bulkPosterId)?.url} alt="" className="h-16 rounded-md border border-line object-cover" /> : null}
            <p className="text-xs text-muted">{chatTotal.toLocaleString("en-IN")} leads on {desk?.name ?? "this desk"}.</p>
          </div>
        </section>
      ) : null}
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
              <div key={chat.id} className={cn("flex items-center gap-2 border-b border-[#f0f2f5] pr-2 hover:bg-[#f5f6f6]", chat.id === activeId && "bg-[#f0f2f5]")}>
                <button type="button" onClick={() => setActiveId(chat.id)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-xs font-semibold text-[#54656f]">{initials(chat.fullName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{chat.fullName}</span>
                      <span className="text-[11px] text-[#667781]">{format(new Date(chat.createdAt), "dd/MM")}</span>
                    </span>
                    <span className="block truncate text-xs text-[#667781]">{chat.preview || chat.phone}</span>
                  </span>
                </button>
                {write ? <WhatsAppLink phone={chat.phone} text={messageText(bulkText, bulkPosterId)} label={`Open WhatsApp for ${chat.fullName}`} /> : null}
              </div>
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
                <span className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{active.fullName}</p>
                  <p className="text-xs text-[#667781]">{active.phone} · {desk?.name}</p>
                </span>
                {write ? <WhatsAppLink phone={active.phone} text={openText} label={`Open WhatsApp for ${active.fullName}`} /> : null}
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
                  onSubmit={(event) => event.preventDefault()}
                >
                  <select value={posterId} onChange={(event) => setPosterId(event.target.value)} className="h-10 rounded-md border border-line bg-white px-2 text-xs">
                    <option value="">Poster</option>
                    {posters.map((poster) => <option key={poster.id} value={poster.id}>{poster.filename}</option>)}
                  </select>
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message to open in WhatsApp" className="h-10 flex-1 rounded-md border border-line px-3 text-sm outline-none" />
                  {openHref ? (
                    <a href={openHref} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#25D366] px-3 text-sm font-medium text-white hover:bg-[#1ebe5d]">Open WhatsApp</a>
                  ) : <span className="text-xs text-muted">This lead has no phone number.</span>}
                </form>
              ) : <p className="bg-[#f0f2f5] px-4 py-3 text-xs text-[#667781]">WhatsApp opens for Admin and the telecallers.</p>}
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
