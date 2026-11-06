import { format } from "date-fns";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp, canWriteWhatsApp, whatsAppDesk } from "@/lib/production-access";
import { listWorkspaceChannels, type ChannelStatus } from "@/services/channel-settings";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import {
  countWhatsAppRecipients,
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
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function outgoing(direction: string) {
  return direction === "outbound" || direction === "out";
}

const QUICK_REPLIES = [
  { label: "Welcome", text: "Hello, thank you for messaging us. How can we help you today?" },
  { label: "Follow-up", text: "Hello, this is a follow-up. Reply here and our team will assist you." },
  { label: "Appointment", text: "Hello, reply to this message to confirm or change your appointment." },
];

export function ProductionWhatsApp() {
  const { productionUser } = useAuth();
  const role = productionUser?.roleKey ?? "";
  const write = canWriteWhatsApp(role);
  const admin = canOperateWhatsApp(role);
  const deskMode = whatsAppDesk(role);
  const [mode, setMode] = useState<"automation" | "inbox">(admin ? "automation" : "inbox");
  const [campaignText, setCampaignText] = useState("Hi, this is a message from Dr. K's Aesthetic Clinic.");
  const [recipientTotal, setRecipientTotal] = useState(0);
  const [bulkSent, setBulkSent] = useState(0);
  const [bulkFailed, setBulkFailed] = useState(0);
  const [line, setLine] = useState<ChannelStatus | null>(null);
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
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [chatReload, setChatReload] = useState(0);
  const [page, setPage] = useState(1);
  const endRef = useRef<HTMLDivElement>(null);
  const visibleDesks = useMemo(
    () => workspaces.filter((item) => deskMode === "both" || item.workspaceType === deskMode),
    [deskMode, workspaces],
  );
  const desk = visibleDesks.find((item) => item.id === deskId) ?? visibleDesks[0];
  const active = chats.find((item) => item.id === activeId) ?? null;

  useEffect(() => {
    setMode(admin ? "automation" : "inbox");
  }, [admin]);

  useEffect(() => {
    void listWorkspaces()
      .then(setWorkspaces)
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not load WhatsApp"));
    void listWhatsAppNumbers()
      .then(setNumbers)
      .catch(() => setNumbers([]));
  }, []);

  useEffect(() => {
    if (!desk && !admin && visibleDesks[0]) setDeskId(visibleDesks[0].id);
    if (admin && !deskId) setDeskId("all");
  }, [admin, desk, deskId, visibleDesks]);

  useEffect(() => {
    if (mode !== "inbox") return;
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
  }, [admin, desk, deskId, mode, page, search, chatReload, visibleDesks]);

  useEffect(() => {
    const onLead = () => setChatReload((value) => value + 1);
    window.addEventListener("bitvion-lead", onLead);
    window.addEventListener("bitvion-lead-update", onLead);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && mode === "inbox") onLead();
    }, 5000);
    return () => {
      window.removeEventListener("bitvion-lead", onLead);
      window.removeEventListener("bitvion-lead-update", onLead);
      window.clearInterval(timer);
    };
  }, [mode]);

  useEffect(() => {
    if (!activeId || mode !== "inbox") {
      setThread([]);
      return;
    }
    void listWhatsAppThread(activeId).then(setThread).catch(() => setThread([]));
  }, [activeId, mode]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread]);

  useEffect(() => {
    if (mode !== "automation" || !desk) return;
    void countWhatsAppRecipients(desk.id, { from: "", to: "", name: "" })
      .then((result) => setRecipientTotal(result.total))
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not count leads"));
    void listWhatsAppPosters(desk.id).then(setPosters).catch(() => setPosters([]));
    void listWorkspaceChannels()
      .then((rows) => setLine(rows.find((row) => row.workspaceId === desk.id && row.channel === "whatsapp") ?? null))
      .catch(() => setLine(null));
  }, [desk, mode]);

  const sendingNumber =
    numbers.find((item) => item.displayPhone.replace(/\D/g, "").endsWith("9562429928")) ??
    numbers.find((item) => item.workspaceType === "clinic");
  const fromLine = sendingNumber?.displayPhone || "WhatsApp";

  const sendDirect = () => {
    if (!active?.phone) return;
    const poster = posters.find((item) => item.id === posterId);
    setBusy("send");
    void sendWhatsAppMessage({
      leadId: active.id,
      to: active.phone,
      text: draft.trim(),
      bulkSize: 1,
      imageUrl: poster?.url,
    })
      .then((status) => {
        setNotice(status === "sent" ? `Sent from ${fromLine}.` : status);
        if (status === "sent") setDraft("");
        return listWhatsAppThread(active.id);
      })
      .then(setThread)
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not send"))
      .finally(() => setBusy(""));
  };

  const chip = (on: boolean) =>
    cn("rounded-full px-3 py-1 text-xs font-medium", on ? "bg-[#d9fdd3] text-[#008069]" : "bg-[#f0f2f5] text-[#54656f]");

  const savePoster = (file: File | undefined) => {
    if (!file || !desk) return;
    setBusy("poster");
    void saveWhatsAppPoster(desk, file)
      .then(() => listWhatsAppPosters(desk.id))
      .then((next) => {
        setPosters(next);
        if (next[0]) setPosterId(next[0].id);
        setNotice("Poster saved on the live site.");
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not save the poster"))
      .finally(() => setBusy(""));
  };

  const lineBlocked = line?.status === "error" || line?.accessTokenSet === false;
  const lineMessage = line?.detail || "The WhatsApp token for +91 95624 29928 has expired. In Settings, open WhatsApp and paste a token that does not expire.";

  const sendCampaign = () => {
    if (!desk || lineBlocked) return;
    const poster = posters.find((item) => item.id === posterId);
    const text = campaignText.trim();
    if (!text && !poster?.url) {
      setNotice("Add a message or a poster.");
      return;
    }
    const together = poster?.url ? "this message and poster" : "this message";
    const approved = window.confirm(`Send ${together} to ${recipientTotal.toLocaleString("en-IN")} CRM leads from ${fromLine}?`);
    if (!approved) return;
    setBusy("bulk");
    setBulkSent(0);
    setBulkFailed(0);
    void (async () => {
      let offset = 0;
      let sent = 0;
      let failed = 0;
      try {
        for (let guard = 0; guard < 2000; guard += 1) {
          const batch = await sendWhatsAppBulk({
            text,
            imageUrl: poster?.url || undefined,
            workspaceId: desk.id,
            offset,
          });
          sent += batch.sent;
          failed += batch.failed;
          setBulkSent(sent);
          setBulkFailed(failed);
          if (batch.total) setRecipientTotal(batch.total);
          if (batch.done || batch.next <= offset) break;
          offset = batch.next;
        }
        setNotice(`Sent ${sent.toLocaleString("en-IN")} from ${fromLine}. Failed ${failed.toLocaleString("en-IN")}.`);
      } catch (reason: unknown) {
        setNotice(reason instanceof Error ? reason.message : "Could not send");
      } finally {
        setBusy("");
      }
    })();
  };

  if (admin && mode === "automation") {
    const poster = posters.find((item) => item.id === posterId);
    return (
      <div className="-mx-3 -mt-4 mb-[-6rem] flex h-[calc(100dvh-4.25rem)] flex-col bg-white sm:-mx-6 lg:-mx-8 lg:mb-0">
        <header className="flex flex-wrap items-center gap-2 border-b border-[#e9edef] bg-[#f0f2f5] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#111b21]">WhatsApp</p>
            <p className="text-xs text-[#667781]">Live site · sends from {fromLine}</p>
          </div>
          <button type="button" className={chip(true)} onClick={() => setMode("automation")}>
            Campaigns
          </button>
          {write ? (
            <button type="button" className={chip(false)} onClick={() => setMode("inbox")}>
              Inbox
            </button>
          ) : null}
          {visibleDesks.length > 1 ? (
            <select
              aria-label="Workspace"
              value={desk?.id || ""}
              onChange={(event) => setDeskId(event.target.value)}
              className="h-8 rounded-full border border-[#e9edef] bg-white px-3 text-xs text-[#111b21]"
            >
              {visibleDesks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.workspaceType === "institute" ? "Institute" : "Clinic"} · {item.name}
                </option>
              ))}
            </select>
          ) : null}
        </header>
        {notice ? <p className="bg-[#d9fdd3] px-4 py-2 text-center text-xs text-[#111b21]">{notice}</p> : null}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f0f2f5] px-4 py-6">
          <form
            className="mx-auto flex max-w-xl flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              sendCampaign();
            }}
          >
            <div>
              <p className="text-lg font-semibold text-[#111b21]">Send message and poster</p>
              <p className="mt-1 text-sm text-[#667781]">
                {recipientTotal.toLocaleString("en-IN")} CRM leads on {desk?.name || "this desk"}. This runs on the live site.
              </p>
            </div>
            {lineBlocked ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                {lineMessage}{" "}
                <Link to="/settings" className="font-medium underline">
                  Open Settings
                </Link>
              </p>
            ) : null}
            <label className="block text-sm text-[#111b21]">
              Message
              <textarea
                value={campaignText}
                onChange={(event) => setCampaignText(event.target.value)}
                rows={5}
                className="mt-1 w-full rounded-xl border border-[#e9edef] px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="block text-sm text-[#111b21]">
              Poster sent with the message
              <select
                value={posterId}
                onChange={(event) => setPosterId(event.target.value)}
                aria-label="Poster sent with the message"
                className="mt-1 h-10 w-full rounded-xl border border-[#e9edef] bg-white px-3 text-sm"
              >
                <option value="">No poster — text only</option>
                {posters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.filename}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-[#008069]">
              Upload poster
              <input
                type="file"
                accept="image/*"
                className="mt-1 block w-full text-xs text-[#54656f]"
                onChange={(event) => savePoster(event.target.files?.[0])}
              />
            </label>
            {poster?.url ? <img src={poster.url} alt="" className="max-h-48 rounded-xl object-contain" /> : null}
            {busy === "bulk" ? (
              <p className="text-sm text-[#111b21]">
                Sent {bulkSent.toLocaleString("en-IN")} · failed {bulkFailed.toLocaleString("en-IN")} · {recipientTotal.toLocaleString("en-IN")} leads
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy === "bulk" || busy === "poster" || recipientTotal < 1 || lineBlocked}
              className="h-11 rounded-full bg-[#00a884] text-sm font-medium text-white disabled:opacity-60"
            >
              {busy === "bulk"
                ? "Sending…"
                : `Send message${poster?.url ? " + poster" : ""} to ${recipientTotal.toLocaleString("en-IN")} leads`}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-3 -mt-4 mb-[-6rem] bg-[#d1d7db] sm:-mx-6 lg:-mx-8 lg:mb-0 lg:h-[calc(100dvh-4.25rem)]">
      {notice ? <p className="bg-[#d9fdd3] px-4 py-2 text-center text-xs text-[#111b21]">{notice}</p> : null}
      <div className={cn("mx-auto grid h-[calc(100dvh-8.5rem)] max-w-[1600px] overflow-hidden bg-white shadow-sm lg:h-full lg:grid-cols-[400px_1fr]")}>
        <aside className={cn("flex min-h-0 flex-col border-[#e9edef] lg:border-r", activeId && "max-lg:hidden")}>
          <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3">
            <div>
              <p className="text-[15px] font-semibold text-[#111b21]">Inbox</p>
              <p className="text-xs text-[#667781]">{fromLine}</p>
            </div>
            <div className="flex gap-2">
              {admin ? (
                <button type="button" className={chip(false)} onClick={() => setMode("automation")}>
                  Campaigns
                </button>
              ) : null}
              <span className="rounded-full bg-[#25D366] px-2 py-1 text-[11px] font-semibold text-white">
                {chatTotal.toLocaleString("en-IN")}
              </span>
            </div>
          </header>
          {write ? (
            <div className="flex gap-2 overflow-x-auto bg-white px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  if (admin) setDeskId("all");
                  setPage(1);
                }}
                className={chip(deskId === "all" || !admin)}
              >
                All
              </button>
              {deskMode === "both"
                ? visibleDesks.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setDeskId(item.id);
                        setPage(1);
                      }}
                      className={chip(item.id === desk?.id && deskId !== "all")}
                    >
                      {item.workspaceType === "clinic" ? "Clinic" : "Institute"}
                    </button>
                  ))
                : null}
            </div>
          ) : null}
          <label className="px-3 pb-2">
            <span className="flex items-center gap-3 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm text-[#54656f]">
              <Search className="size-4" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search or start a new chat"
                className="w-full bg-transparent text-[#111b21] outline-none placeholder:text-[#667781]"
              />
            </span>
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => setActiveId(chat.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#f5f6f6]",
                  chat.id === activeId && "bg-[#f0f2f5]",
                )}
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-medium text-[#54656f]">
                  {initials(chat.fullName)}
                </span>
                <span className="min-w-0 flex-1 border-b border-[#e9edef] pb-3">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[17px] text-[#111b21]">{chat.fullName}</span>
                    <span className="shrink-0 text-xs text-[#667781]">{format(new Date(chat.createdAt), "dd/MM/yyyy")}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-[#667781]">{chat.preview || chat.phone}</span>
                </span>
              </button>
            ))}
            {chats.length === 0 ? <p className="px-3 py-6 text-sm text-[#667781]">No chats.</p> : null}
          </div>
        </aside>
        <section className={cn("wa-wallpaper flex min-h-0 flex-col", !activeId && "max-lg:hidden")}>
          {active ? (
            <>
              <header className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-2">
                <button type="button" className="text-xl text-[#54656f] lg:hidden" onClick={() => setActiveId("")} aria-label="Back">
                  ‹
                </button>
                <span className="flex size-10 items-center justify-center rounded-full bg-[#dfe5e7] text-sm text-[#54656f]">
                  {initials(active.fullName)}
                </span>
                <span className="min-w-0 flex-1">
                  <p className="truncate text-[16px] text-[#111b21]">{active.fullName}</p>
                  <p className="truncate text-xs text-[#667781]">{active.phone}</p>
                </span>
              </header>
              <div className="flex-1 space-y-1.5 overflow-y-auto px-[6%] py-4">
                {thread.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "relative max-w-[65%] px-2 py-1.5 text-[14.2px] leading-snug text-[#111b21] shadow-sm",
                      outgoing(entry.direction) ? "ml-auto rounded-lg rounded-tr-none bg-[#d9fdd3]" : "rounded-lg rounded-tl-none bg-white",
                    )}
                  >
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
                      <button
                        key={reply.label}
                        type="button"
                        className="shrink-0 rounded-full bg-white px-3 py-1 text-xs text-[#008069] shadow-sm"
                        onClick={() => setDraft(reply.text)}
                      >
                        {reply.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <select
                      value={posterId}
                      onChange={(event) => setPosterId(event.target.value)}
                      aria-label="Poster"
                      className="h-11 rounded-full bg-white px-3 text-xs text-[#54656f] outline-none"
                    >
                      <option value="">Poster</option>
                      {posters.map((poster) => (
                        <option key={poster.id} value={poster.id}>
                          {poster.filename}
                        </option>
                      ))}
                    </select>
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Type a message"
                      className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-[15px] text-[#111b21] outline-none"
                    />
                    {active.phone ? (
                      <button
                        type="submit"
                        aria-label="Send"
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white disabled:opacity-60"
                      >
                        {busy === "send" ? "…" : "➤"}
                      </button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </>
          ) : (
            <div className="m-auto max-w-md px-8 text-center">
              <p className="text-[32px] font-light text-[#41525d]">Inbox</p>
              <p className="mt-3 text-sm text-[#667781]">
                {admin ? "Select a chat, or switch to Campaigns for bulk automation." : "Bulk messaging is limited to Admin. Select a chat to reply."}
              </p>
              {admin ? (
                <button type="button" className="mt-4 rounded-full bg-[#00a884] px-4 py-2 text-sm font-medium text-white" onClick={() => setMode("automation")}>
                  Open Campaigns
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageBody({ body }: { body: string }) {
  const poster = body.split("\n").find((line) => line.startsWith("Poster: "));
  const text = body
    .split("\n")
    .filter((line) => !line.startsWith("Poster: "))
    .join("\n")
    .trim();
  return (
    <>
      {poster ? <p className="mb-1 text-xs font-medium">Poster · {poster.slice("Poster: ".length)}</p> : null}
      <p className="whitespace-pre-wrap">{text || body}</p>
    </>
  );
}
