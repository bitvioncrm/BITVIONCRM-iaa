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
  countWhatsAppSentToday,
  listWhatsAppCampaigns,
  listWhatsAppChats,
  listWhatsAppNumbers,
  listWhatsAppPosters,
  listWhatsAppThread,
  loadWhatsAppProfile,
  removeWhatsAppCampaign,
  removeWhatsAppPoster,
  saveWhatsAppNumber,
  saveWhatsAppProfilePicture,
  saveWhatsAppCampaign,
  saveWhatsAppPoster,
  listWhatsAppCampaignSends,
  sendWhatsAppBulk,
  sendWhatsAppMessage,
  sendWhatsAppTest,
  type WhatsAppCampaign,
  type WhatsAppSendResult,
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
  const [mode, setMode] = useState<"automation" | "clicks" | "inbox">(admin ? "automation" : "inbox");
  const [campaignId, setCampaignId] = useState("");
  const [campaignCursor, setCampaignCursor] = useState(0);
  const [campaignName, setCampaignName] = useState("Clinic offer");
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [sentToday, setSentToday] = useState(0);
  const [pictureUrl, setPictureUrl] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneReady, setPhoneReady] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testReady, setTestReady] = useState(false);
  const [sendPreview, setSendPreview] = useState(false);
  const [sendLog, setSendLog] = useState<WhatsAppSendResult[]>([]);
  const [sendFilter, setSendFilter] = useState<"all" | "sent" | "failed" | "skipped">("all");
  const [campaignText, setCampaignText] = useState("Hi {name}, this is a message from Dr. K's Aesthetic Clinic.");
  const [recipientTotal, setRecipientTotal] = useState(0);
  const [bulkSent, setBulkSent] = useState(0);
  const [bulkFailed, setBulkFailed] = useState(0);
  const [line, setLine] = useState<ChannelStatus | null>(null);
  const [clickTotal, setClickTotal] = useState(0);
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
    if (mode === "automation") return;
    const workspaceId = !admin || deskId !== "all" ? desk?.id ?? "" : "";
    if (!admin && !desk) return;
    void listWhatsAppChats(workspaceId, search, mode === "clicks" || !admin ? "clicks" : "all", page)
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
    if (!desk || (mode !== "automation" && mode !== "inbox")) return;
    void listWhatsAppPosters(desk.id).then(setPosters).catch(() => setPosters([]));
    if (mode !== "automation") return;
    void countWhatsAppRecipients(desk.id, { from: "", to: "", name: "" })
      .then((result) => setRecipientTotal(result.total))
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not count leads"));
    void listWhatsAppChats(desk.id, "", "clicks", 1)
      .then((result) => setClickTotal(result.total))
      .catch(() => setClickTotal(0));
    void listWorkspaceChannels()
      .then((rows) => setLine(rows.find((row) => row.workspaceId === desk.id && row.channel === "whatsapp") ?? null))
      .catch(() => setLine(null));
    void listWhatsAppCampaigns(desk.id).then(setCampaigns).catch(() => setCampaigns([]));
    void countWhatsAppSentToday(desk.id)
      .then((result) => setSentToday(result.sent))
      .catch(() => undefined);
    void loadWhatsAppProfile(desk.id)
      .then((profile) => setPictureUrl(profile.pictureUrl))
      .catch(() => setPictureUrl(""));
  }, [desk, mode]);

  const sendingNumber = numbers.find((item) => item.workspaceId === desk?.id);
  const savedPhone = line?.displayPhone || sendingNumber?.displayPhone || "";
  const fromLine = phoneDraft.trim() || savedPhone || "WhatsApp";

  useEffect(() => {
    setPhoneReady("");
    setCampaignId("");
    setCampaignCursor(0);
    setPosterId("");
    setPictureUrl("");
    setTestReady(false);
    setSendPreview(false);
    setSendLog([]);
    setSendFilter("all");
    const institute = desk?.workspaceType === "institute";
    setCampaignName(institute ? "Institute offer" : "Clinic offer");
    setCampaignText(institute ? "Hi {name}, this is a message from IAA Kochi." : "Hi {name}, this is a message from Dr. K's Aesthetic Clinic.");
  }, [desk?.id, desk?.workspaceType]);

  useEffect(() => {
    if (savedPhone && savedPhone !== phoneReady) {
      setPhoneDraft(savedPhone);
      setPhoneReady(savedPhone);
    }
  }, [savedPhone, phoneReady]);

  const saveNumber = () => {
    if (!desk) return;
    const phone = phoneDraft.trim();
    if (phone.replace(/\D/g, "").length < 10) {
      setNotice("Enter the full WhatsApp number, including 91.");
      return;
    }
    setBusy("phone");
    void saveWhatsAppNumber(desk.id, phone)
      .then(() => listWhatsAppNumbers())
      .then((rows) => {
        setNumbers(rows);
        setPhoneReady(phone);
        setNotice("Sending number saved. Campaigns and posters leave from this line.");
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not save the number"))
      .finally(() => setBusy(""));
  };

  const saveProfilePhoto = (file: File | undefined) => {
    if (!file) return;
    const local = URL.createObjectURL(file);
    setPictureUrl(local);
    setBusy("photo");
    void saveWhatsAppProfilePicture(file, desk?.id ?? "")
      .then((profile) => {
        if (profile.pictureUrl) setPictureUrl(profile.pictureUrl);
        setNotice("WhatsApp profile photo updated for this sending number.");
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not update the profile photo"))
      .finally(() => setBusy(""));
  };

  const deletePoster = (id: string) => {
    setBusy("poster");
    void removeWhatsAppPoster(id)
      .then(() => (desk ? listWhatsAppPosters(desk.id) : []))
      .then((next) => {
        setPosters(next);
        if (posterId === id) setPosterId("");
        setNotice("Poster removed.");
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not remove the poster"))
      .finally(() => setBusy(""));
  };

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
        const ok = status === "sent" || /delivered|submitted/i.test(status);
        setNotice(ok ? `Sent from ${fromLine}.` : status);
        if (ok) setDraft("");
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

  const lineBlocked = line?.status === "error" || line?.accessTokenSet !== true;
  const lineMessage = line?.detail || `Save the WhatsApp token for ${fromLine} before sending.`;

  const refreshCampaigns = () => {
    if (!desk) return Promise.resolve();
    return Promise.all([
      listWhatsAppCampaigns(desk.id).then(setCampaigns),
      countWhatsAppSentToday(desk.id).then((result) => setSentToday(result.sent)),
    ]).then(() => undefined);
  };

  const writeCampaign = (status: WhatsAppCampaign["status"], sent: number, failed: number, total: number, cursor: number, id = campaignId) => {
    if (!desk) return Promise.resolve("");
    return saveWhatsAppCampaign({
      id: id || undefined,
      organizationId: desk.organizationId,
      workspaceId: desk.id,
      name: campaignName,
      body: campaignText,
      posterId,
      status,
      sent,
      failed,
      total,
      cursor,
    }).then((saved) => {
      setCampaignId(saved);
      return refreshCampaigns().then(() => saved);
    });
  };

  const openCampaign = (item: WhatsAppCampaign, filter: "all" | "sent" | "failed" | "skipped" = "all") => {
    setCampaignId(item.id);
    setCampaignName(item.name);
    setCampaignText(item.body);
    setPosterId(item.posterId);
    setCampaignCursor(item.cursor);
    setTestReady(false);
    setSendPreview(true);
    setSendFilter(filter);
    setMode("automation");
    loadCampaignSends(item.id, filter === "all" ? "all" : filter);
  };

  const deskLabel = desk?.workspaceType === "institute" ? "Institute" : "Clinic";
  const defaultCampaignName = desk?.workspaceType === "institute" ? "Institute offer" : "Clinic offer";
  const defaultCampaignText = desk?.workspaceType === "institute"
    ? "Hi {name}, this is a message from IAA Kochi."
    : "Hi {name}, this is a message from Dr. K's Aesthetic Clinic.";

  const startCampaign = () => {
    setCampaignId("");
    setCampaignName(defaultCampaignName);
    setCampaignText(defaultCampaignText);
    setPosterId("");
    setCampaignCursor(0);
  };

  const saveDraft = () => {
    if (!desk) return;
    setBusy("save");
    const current = campaigns.find((item) => item.id === campaignId);
    void writeCampaign(current?.status ?? "draft", current?.sent ?? 0, current?.failed ?? 0, current?.total || recipientTotal, current?.cursor ?? campaignCursor)
      .then(() => setNotice("Campaign saved."))
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not save"))
      .finally(() => setBusy(""));
  };

  const deleteCampaign = (id: string) => {
    if (!window.confirm("Delete this campaign?")) return;
    void removeWhatsAppCampaign(id)
      .then(() => {
        if (campaignId === id) startCampaign();
        return refreshCampaigns();
      })
      .then(() => setNotice("Campaign deleted."))
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "Could not delete"));
  };

  const loadCampaignSends = (id: string, filter: "all" | "sent" | "failed" | "skipped" = sendFilter) => {
    if (!id) {
      setSendLog([]);
      return;
    }
    void listWhatsAppCampaignSends(id, filter)
      .then(setSendLog)
      .catch(() => setSendLog([]));
  };

  const sendTest = () => {
    if (!desk || lineBlocked) return;
    const poster = posters.find((item) => item.id === posterId);
    const text = campaignText.trim();
    const to = testPhone.trim();
    if (!to) {
      setNotice("Enter a WhatsApp number for the test message.");
      return;
    }
    if (!text && !poster?.url) {
      setNotice("Add a message or a poster before the test.");
      return;
    }
    setBusy("test");
    void sendWhatsAppTest({
      workspaceId: desk.id,
      to,
      text: text.replaceAll("{name}", "Test").replaceAll("{phone}", to),
      imageUrl: poster?.url || undefined,
    })
      .then((status) => {
        const ok = status === "sent" || /test (sent|delivered|submitted)/i.test(status);
        setTestReady(ok);
        setNotice(ok ? `${status} Full send is unlocked.` : status);
      })
      .catch((reason: unknown) => {
        setTestReady(false);
        setNotice(reason instanceof Error ? reason.message : "Could not send the test");
      })
      .finally(() => setBusy(""));
  };

  const openSendPreview = () => {
    if (!desk || lineBlocked) return;
    const poster = posters.find((item) => item.id === posterId);
    const text = campaignText.trim();
    if (!text && !poster?.url) {
      setNotice("Add a message or a poster.");
      return;
    }
    const waiting = Math.max(0, recipientTotal - campaignCursor);
    if (waiting < 1) {
      setNotice("This campaign has already reached every lead.");
      return;
    }
    setSendPreview(true);
    setNotice("Send a test to one number first, then start the full send.");
  };

  const sendCampaign = () => {
    if (!desk || lineBlocked) return;
    if (!testReady) {
      setNotice("Send a test message to one number before the full send.");
      setSendPreview(true);
      return;
    }
    const poster = posters.find((item) => item.id === posterId);
    const text = campaignText.trim();
    if (!text && !poster?.url) {
      setNotice("Add a message or a poster.");
      return;
    }
    const waiting = Math.max(0, recipientTotal - campaignCursor);
    if (waiting < 1) {
      setNotice("This campaign has already reached every lead.");
      return;
    }
    const together = poster?.url ? "this message and poster" : "this message";
    const approved = window.confirm(`Test went to ${testPhone.trim()}. Send ${together} to all ${waiting.toLocaleString("en-IN")} waiting leads from ${fromLine}?`);
    if (!approved) return;
    setSendPreview(false);
    setBusy("bulk");
    setBulkSent(0);
    setBulkFailed(0);
    setSendLog([]);
    setSendFilter("all");
    void (async () => {
      let offset = campaignCursor;
      let sent = 0;
      let failed = 0;
      let total = recipientTotal;
      const current = campaigns.find((item) => item.id === campaignId);
      let savedId = campaignId;
      try {
        savedId = await writeCampaign("running", current?.sent ?? 0, current?.failed ?? 0, total, offset);
        setCampaignId(savedId);
        for (let guard = 0; guard < 5000; guard += 1) {
          try {
            const batch = await sendWhatsAppBulk({
              text,
              imageUrl: poster?.url || undefined,
              workspaceId: desk.id,
              offset,
              campaignId: savedId,
            });
            sent += batch.sent;
            failed += batch.failed;
            setBulkSent(sent);
            setBulkFailed(failed);
            if (batch.results.length) setSendLog((currentLog) => [...batch.results, ...currentLog].slice(0, 300));
            if (batch.total) {
              total = batch.total;
              setRecipientTotal(batch.total);
            }
            const previous = offset;
            offset = batch.next;
            setCampaignCursor(offset);
            await writeCampaign(offset >= total ? "completed" : "running", (current?.sent ?? 0) + sent, (current?.failed ?? 0) + failed, total, offset, savedId);
            if (batch.done || offset <= previous) break;
          } catch (reason: unknown) {
            const message = reason instanceof Error ? reason.message : "Could not send";
            await writeCampaign("running", (current?.sent ?? 0) + sent, (current?.failed ?? 0) + failed, total, offset, savedId);
            if (/timed out|live server/i.test(message) && offset > campaignCursor) {
              setNotice(`${message} Sent ${sent.toLocaleString("en-IN")} so far. Press Send again to continue.`);
              loadCampaignSends(savedId, "all");
              return;
            }
            throw reason;
          }
        }
        setNotice(`Sent ${sent.toLocaleString("en-IN")} from ${fromLine}. Failed ${failed.toLocaleString("en-IN")}.`);
        loadCampaignSends(savedId, "all");
      } catch (reason: unknown) {
        setNotice(reason instanceof Error ? reason.message : "Could not send");
      } finally {
        setBusy("");
      }
    })();
  };

  const selectedPoster = posters.find((item) => item.id === posterId);

  if (admin && mode !== "inbox") {
    const poster = selectedPoster;
    const preview = campaignText.replaceAll("{name}", "Asha").replaceAll("{phone}", "9198…");
    const navItem = (active: boolean) =>
      cn(
        "flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm",
        active ? "bg-[#25d36622] text-white shadow-[inset_3px_0_0_#25d366]" : "text-[#d1d7db] hover:bg-white/10",
      );
    return (
      <div className="-mx-3 -mt-4 mb-[-6rem] flex h-[calc(100dvh-4.25rem)] overflow-hidden bg-[#f4f6f8] sm:-mx-6 lg:-mx-8 lg:mb-0">
        <aside className="hidden w-[240px] shrink-0 flex-col bg-[#111b21] px-3 py-4 text-[#e9edef] md:flex">
          <div className="flex items-center gap-3 px-2 pb-4">
            {pictureUrl ? (
              <img src={pictureUrl} alt="" className="size-12 rounded-full object-cover ring-2 ring-[#25D366]" onError={() => setPictureUrl("")} />
            ) : (
              <span className="grid size-12 place-items-center rounded-full bg-[#25D366] text-sm font-bold text-white">WA</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{fromLine}</span>
              <span className="block text-xs text-[#8696a0]">{lineBlocked ? "Token needed" : "Sending number"}</span>
            </span>
          </div>
          <nav className="flex flex-col gap-1">
            <button type="button" className={navItem(mode === "automation")} onClick={() => setMode("automation")}>Bulk messaging</button>
            <button type="button" className={navItem(mode === "clicks")} onClick={() => setMode("clicks")}>Click leads</button>
            <button type="button" className={navItem(false)} onClick={() => setMode("inbox")}>Inbox</button>
          </nav>
          <div className="mt-auto rounded-2xl border border-white/10 bg-white/10 p-3">
            <div className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", lineBlocked ? "bg-red-400" : "bg-[#25D366]")} />
              <span>
                <span className="block text-sm font-medium">{lineBlocked ? "Token needed" : "Connected"}</span>
                <span className="block text-xs text-[#8696a0]">{fromLine}</span>
              </span>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 border-b border-[#e9edef] bg-white px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("size-3 rounded-full", lineBlocked ? "bg-red-400" : "bg-[#25D366] shadow-[0_0_0_4px_#25d36633]")} />
              <p className="truncate text-sm font-semibold text-[#111b21]">{mode === "clicks" ? "Click leads" : "Bulk messaging"}</p>
            </div>
            <div className="flex rounded-full border border-[#e9edef] bg-[#f4f6f8] p-1">
              {visibleDesks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDeskId(item.id)}
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold", item.id === desk?.id ? "bg-white text-[#111b21] shadow-sm" : "text-[#667781]")}
                >
                  {item.workspaceType === "institute" ? "Institute" : "Clinic"}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1 md:hidden">
              <button type="button" className={chip(mode === "automation")} onClick={() => setMode("automation")}>Bulk</button>
              <button type="button" className={chip(mode === "clicks")} onClick={() => setMode("clicks")}>Clicks</button>
              <button type="button" className={chip(false)} onClick={() => setMode("inbox")}>Inbox</button>
            </div>
          </header>
          {notice ? <p className="bg-[#d9fdd3] px-4 py-2 text-center text-xs text-[#111b21]">{notice}</p> : null}
          {mode === "clicks" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-sm">
                <div className="border-b border-[#e9edef] px-4 py-3">
                  <p className="text-sm font-semibold text-[#111b21]">{clickTotal.toLocaleString("en-IN")} click leads</p>
                  <p className="text-xs text-[#667781]">A WhatsApp click is added to CRM leads and assigned. No message is sent until you send a bulk campaign.</p>
                </div>
                <label className="block px-4 py-3">
                  <span className="flex items-center gap-3 rounded-lg bg-[#f0f2f5] px-3 py-2 text-sm text-[#54656f]">
                    <Search className="size-4" />
                    <input
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(1);
                      }}
                      placeholder="Name or phone"
                      className="w-full bg-transparent text-[#111b21] outline-none"
                    />
                  </span>
                </label>
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => {
                      setActiveId(chat.id);
                      setMode("inbox");
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f5f6f6]"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-medium text-[#54656f]">
                      {initials(chat.fullName)}
                    </span>
                    <span className="min-w-0 flex-1 border-b border-[#e9edef] pb-3">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] text-[#111b21]">{chat.fullName}</span>
                        <span className="shrink-0 text-xs text-[#667781]">{format(new Date(chat.createdAt), "dd/MM/yyyy")}</span>
                      </span>
                      <span className="block truncate text-sm text-[#667781]">{chat.preview || chat.phone}</span>
                    </span>
                  </button>
                ))}
                {chats.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[#667781]">No click leads yet. A lead appears here when someone messages {fromLine}.</p> : null}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <div className="mx-auto flex max-w-6xl flex-col gap-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <article className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#07362c] via-[#0f6e56] to-[#1fa87a] p-5 text-white shadow-[0_18px_40px_rgba(15,110,86,0.28)]">
                    <span className="absolute -right-6 -top-8 size-28 rounded-full bg-white/10" />
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-white/70 uppercase">Campaigns running</p>
                    <p className="mt-3 text-4xl font-semibold tabular-nums">{campaigns.filter((item) => item.status === "running").length}</p>
                    <p className="mt-2 text-xs text-white/80">{campaigns.length} saved · one press sends every waiting lead</p>
                  </article>
                  <article className="relative overflow-hidden rounded-3xl bg-[#111b21] p-5 text-white shadow-[0_18px_40px_rgba(17,27,33,0.22)]">
                    <span className="absolute -right-8 bottom-0 size-24 rounded-full bg-[#25D366]/20" />
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-[#8696a0] uppercase">Leads sent</p>
                    <p className="mt-3 text-4xl font-semibold tabular-nums text-[#d9fdd3]">{sentToday.toLocaleString("en-IN")}</p>
                    <p className="mt-2 text-xs text-[#8696a0]">{busy === "bulk" ? `${bulkSent.toLocaleString("en-IN")} in this send` : "Messages delivered today"}</p>
                  </article>
                  <article className="relative overflow-hidden rounded-3xl border border-[#e7d7b1] bg-gradient-to-br from-[#fffaf0] to-[#f3e6c8] p-5 text-[#3d2e12] shadow-[0_18px_40px_rgba(184,146,62,0.16)]">
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-[#8a6a32] uppercase">Still waiting</p>
                    <p className="mt-3 text-4xl font-semibold tabular-nums">{Math.max(recipientTotal - campaignCursor, 0).toLocaleString("en-IN")}</p>
                    <p className="mt-2 text-xs text-[#8a6a32]">one press sends all of them</p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#ead9b0]">
                      <div className="h-full rounded-full bg-[#b8923e]" style={{ width: `${recipientTotal > 0 ? Math.min(100, (Math.max(recipientTotal - campaignCursor, 0) / recipientTotal) * 100) : 0}%` }} />
                    </div>
                  </article>
                </div>
                <section className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="relative grid size-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-[#111b21] text-xs font-semibold text-white ring-2 ring-[#25D366]">
                      {pictureUrl ? <img src={pictureUrl} alt="" className="size-full object-cover" onError={() => setPictureUrl("")} /> : "DP"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => saveProfilePhoto(event.target.files?.[0])} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold tracking-wide text-[#667781] uppercase">Sending number and WhatsApp DP</p>
                      <p className="mt-1 text-sm text-[#667781]">This is the {deskLabel.toLowerCase()} line saved for sending. The photo is the profile picture customers see on WhatsApp. Click leads are assigned only. A message goes out when you press Send.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <input
                          value={phoneDraft}
                          onChange={(event) => setPhoneDraft(event.target.value)}
                          aria-label="Sending WhatsApp number"
                          placeholder="+91 95624 29928"
                          className="h-10 min-w-[220px] flex-1 rounded-xl border border-[#e9edef] px-3 text-sm outline-none"
                        />
                        <button type="button" disabled={busy === "phone"} onClick={saveNumber} className="h-10 rounded-full bg-[#111b21] px-4 text-sm font-semibold text-white disabled:opacity-60">
                          Save number
                        </button>
                        <label className="inline-flex h-10 cursor-pointer items-center rounded-full bg-[#f0f2f5] px-4 text-sm font-medium text-[#111b21]">
                          {busy === "photo" ? "Updating photo…" : "Set WhatsApp DP"}
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => saveProfilePhoto(event.target.files?.[0])} />
                        </label>
                      </div>
                    </div>
                  </div>
                </section>
                {sendPreview || busy === "bulk" || sendLog.length > 0 ? (
                  <section className="rounded-3xl border border-[#d9fdd3] bg-[#f7fff9] p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold tracking-wide text-[#008069] uppercase">Send preview</p>
                        <p className="mt-1 text-sm text-[#667781]">
                          {busy === "bulk"
                            ? `Sending from ${fromLine} · ${bulkSent.toLocaleString("en-IN")} sent · ${bulkFailed.toLocaleString("en-IN")} not sent`
                            : `Test one number first. Then send to ${Math.max(recipientTotal - campaignCursor, 0).toLocaleString("en-IN")} waiting leads from ${fromLine}.`}
                        </p>
                      </div>
                      {sendPreview && busy !== "bulk" ? (
                        <button type="button" className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#667781]" onClick={() => setSendPreview(false)}>
                          Close
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-4 rounded-2xl bg-[#0b141a] p-4 text-white">
                      <p className="text-xs text-[#8696a0]">Message preview</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{campaignText.replaceAll("{name}", "Asha") || "Your message appears here."}</p>
                      {selectedPoster?.url ? <img src={selectedPoster.url} alt="" className="mt-3 max-h-36 w-full rounded-lg object-cover" /> : null}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <input
                        value={testPhone}
                        onChange={(event) => {
                          setTestPhone(event.target.value);
                          setTestReady(false);
                        }}
                        aria-label="Test WhatsApp number"
                        placeholder="+91 9xxxxxxxxx"
                        className="h-10 min-w-[220px] flex-1 rounded-xl border border-[#e9edef] bg-white px-3 text-sm outline-none"
                      />
                      <button type="button" disabled={busy === "test" || busy === "bulk" || lineBlocked} onClick={sendTest} className="h-10 rounded-full bg-[#111b21] px-4 text-sm font-semibold text-white disabled:opacity-60">
                        {busy === "test" ? "Sending test…" : testReady ? "Test sent · send again" : "Send test"}
                      </button>
                      <button type="button" disabled={busy === "bulk" || busy === "test" || lineBlocked || !testReady} onClick={sendCampaign} className="h-10 rounded-full bg-[#00a884] px-4 text-sm font-semibold text-white disabled:opacity-60">
                        {busy === "bulk" ? `Sending ${bulkSent.toLocaleString("en-IN")}…` : "Start full send"}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-[#667781]">{testReady ? `Test ready on ${testPhone.trim()}.` : "Full send stays locked until the test message succeeds."}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {([
                        ["all", "All"],
                        ["sent", "Sent"],
                        ["failed", "Not sent"],
                        ["skipped", "Skipped"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={cn("rounded-full px-3 py-1 text-xs font-medium", sendFilter === value ? "bg-[#00a884] text-white" : "bg-white text-[#54656f]")}
                          onClick={() => {
                            setSendFilter(value);
                            if (campaignId) loadCampaignSends(campaignId, value === "all" ? "all" : value);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-[#e9edef] bg-white">
                      {(sendFilter === "all" ? sendLog : sendLog.filter((row) => row.status === sendFilter)).map((row, index) => (
                        <div key={`${row.leadId}-${row.phone}-${index}`} className="flex items-start justify-between gap-3 border-b border-[#f0f2f5] px-3 py-2 last:border-b-0">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#111b21]">{row.name}</p>
                            <p className="truncate text-xs text-[#667781]">{row.phone}{row.detail ? ` · ${row.detail}` : ""}</p>
                          </div>
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", row.status === "sent" ? "bg-[#d9fdd3] text-[#008069]" : "bg-[#fff1f0] text-[#9b2c2c]")}>
                            {row.status === "sent" ? "Sent" : row.status === "skipped" ? "Skipped" : "Not sent"}
                          </span>
                        </div>
                      ))}
                      {sendLog.length === 0 ? <p className="px-3 py-8 text-center text-sm text-[#667781]">{busy === "bulk" ? "Numbers appear here as each message goes out." : "Sent and not-sent numbers appear here after the send starts."}</p> : null}
                    </div>
                  </section>
                ) : (
                  <section className="rounded-3xl border border-[#d9fdd3] bg-[#f7fff9] p-5 shadow-sm">
                    <p className="text-xs font-semibold tracking-wide text-[#008069] uppercase">Message test</p>
                    <p className="mt-1 text-sm text-[#667781]">Enter one WhatsApp number, send a test, then open the send preview before the full bulk.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        value={testPhone}
                        onChange={(event) => {
                          setTestPhone(event.target.value);
                          setTestReady(false);
                        }}
                        aria-label="Test WhatsApp number"
                        placeholder="+91 9xxxxxxxxx"
                        className="h-10 min-w-[220px] flex-1 rounded-xl border border-[#e9edef] bg-white px-3 text-sm outline-none"
                      />
                      <button type="button" disabled={busy === "test" || busy === "bulk" || lineBlocked} onClick={sendTest} className="h-10 rounded-full bg-[#111b21] px-4 text-sm font-semibold text-white disabled:opacity-60">
                        {busy === "test" ? "Sending test…" : "Send test"}
                      </button>
                      <button type="button" disabled={busy === "bulk" || lineBlocked} onClick={openSendPreview} className="h-10 rounded-full bg-[#00a884] px-4 text-sm font-semibold text-white disabled:opacity-60">
                        Preview & send
                      </button>
                    </div>
                  </section>
                )}
                <form
                  className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    openSendPreview();
                  }}
                >
                  <section className="rounded-2xl bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold tracking-wide text-[#667781] uppercase">Campaign</p>
                        <h2 className="mt-1 text-lg font-semibold text-[#111b21]">{campaignId ? "Edit campaign" : "New campaign"}</h2>
                      </div>
                      <button type="button" className="rounded-full bg-[#f0f2f5] px-3 py-1 text-xs font-medium text-[#111b21]" onClick={startCampaign}>New</button>
                    </div>
                    <label className="mt-4 block text-xs font-medium text-[#667781]">
                      Name
                      <input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-[#e9edef] px-3 text-sm text-[#111b21] outline-none" />
                    </label>
                    <p className="mt-2 text-sm text-[#667781]">{fromLine} · {Math.max(recipientTotal - campaignCursor, 0).toLocaleString("en-IN")} waiting</p>
                    {lineBlocked ? (
                      <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                        {lineMessage}{" "}
                        <Link to="/meta" className="font-medium underline">Open Meta leads</Link>
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {QUICK_REPLIES.map((reply) => (
                        <button key={reply.label} type="button" className="rounded-full bg-[#f0f2f5] px-3 py-1 text-xs font-medium text-[#008069]" onClick={() => setCampaignText(reply.text)}>
                          {reply.label}
                        </button>
                      ))}
                      <button type="button" className="rounded-full bg-[#f0f2f5] px-3 py-1 text-xs font-medium text-[#54656f]" onClick={() => setCampaignText((value) => `${value}{name}`)}>
                        {"{name}"}
                      </button>
                    </div>
                    <textarea
                      value={campaignText}
                      onChange={(event) => setCampaignText(event.target.value)}
                      rows={6}
                      aria-label="Message"
                      className="mt-3 w-full rounded-2xl border border-[#e9edef] px-3 py-3 text-sm outline-none"
                    />
                    <div className="mt-4">
                      <p className="text-xs font-medium text-[#667781]">Poster sent with this message</p>
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                        <button
                          type="button"
                          onClick={() => setPosterId("")}
                          className={cn("grid h-24 w-20 shrink-0 place-items-center rounded-2xl border text-center text-[11px] font-medium", posterId ? "border-[#e9edef] text-[#667781]" : "border-[#00a884] bg-[#f3faf7] text-[#008069]")}
                        >
                          Text only
                        </button>
                        {posters.map((item) => (
                          <div key={item.id} className={cn("relative h-24 w-20 shrink-0 overflow-hidden rounded-2xl border", item.id === posterId ? "border-[#00a884] ring-2 ring-[#00a884]" : "border-[#e9edef]")}>
                            <button type="button" className="size-full" onClick={() => setPosterId(item.id)} aria-label={`Send ${item.filename}`}>
                              {item.url ? <img src={item.url} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center px-1 text-[10px]">{item.filename}</span>}
                            </button>
                            <button type="button" className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] text-white" onClick={() => deletePoster(item.id)} aria-label={`Remove ${item.filename}`}>
                              ×
                            </button>
                          </div>
                        ))}
                        <label className="grid h-24 w-20 shrink-0 cursor-pointer place-items-center rounded-2xl border border-dashed border-[#00a884] text-center text-[11px] font-medium text-[#008069]">
                          {busy === "poster" ? "Saving…" : "Add poster"}
                          <input type="file" accept="image/*" className="hidden" onChange={(event) => savePoster(event.target.files?.[0])} />
                        </label>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button type="button" disabled={busy === "save" || busy === "bulk"} onClick={saveDraft} className="h-11 rounded-full border border-[#e9edef] px-4 text-sm font-semibold text-[#111b21] disabled:opacity-60">
                        Save
                      </button>
                      <button
                        type="submit"
                        disabled={busy === "bulk" || busy === "poster" || lineBlocked || Math.max(recipientTotal - campaignCursor, 0) < 1}
                        className="h-11 flex-1 rounded-full bg-[#00a884] text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {busy === "bulk"
                          ? `Sending ${bulkSent.toLocaleString("en-IN")} · failed ${bulkFailed.toLocaleString("en-IN")}`
                          : `Send to ${Math.max(recipientTotal - campaignCursor, 0).toLocaleString("en-IN")}${poster?.url ? " + poster" : ""}`}
                      </button>
                    </div>
                  </section>
                  <section className="rounded-2xl bg-[#0b141a] p-5 text-white shadow-sm">
                    <p className="text-xs text-[#8696a0]">Preview · {fromLine}</p>
                    <div className="mt-4 flex items-center gap-2">
                      {pictureUrl ? <img src={pictureUrl} alt="" className="size-9 rounded-full object-cover" /> : <span className="grid size-9 place-items-center rounded-full bg-[#25D366] text-xs font-bold">WA</span>}
                      <span className="text-sm text-[#e9edef]">{fromLine}</span>
                    </div>
                    <div className="mt-4 max-w-sm rounded-lg rounded-tl-none bg-[#005c4b] px-3 py-2 text-sm leading-snug text-white">
                      {poster?.url ? <img src={poster.url} alt="" className="mb-2 max-h-40 w-full rounded-md object-cover" /> : null}
                      <p className="whitespace-pre-wrap">{preview || "Your message appears here."}</p>
                      <p className="mt-1 text-right text-[11px] text-white/70">now</p>
                    </div>
                  </section>
                </form>
                <section className="rounded-3xl bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold tracking-wide text-[#667781] uppercase">Saved campaigns</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {campaigns.map((item) => (
                      <div key={item.id} className={cn("rounded-2xl border px-3 py-3", item.id === campaignId ? "border-[#00a884] bg-[#f3faf7]" : "border-[#e9edef]")}>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[#111b21]">{item.name}</p>
                            <p className="truncate text-xs text-[#667781]">
                              {item.status} · sent {item.sent.toLocaleString("en-IN")} · not sent {item.failed.toLocaleString("en-IN")} · waiting {Math.max(item.total - item.cursor, 0).toLocaleString("en-IN")}
                            </p>
                          </div>
                          <button type="button" className="rounded-full bg-[#d9fdd3] px-3 py-1 text-xs font-medium text-[#008069]" onClick={() => openCampaign(item, "sent")}>
                            Sent
                          </button>
                          <button type="button" className="rounded-full bg-[#fff1f0] px-3 py-1 text-xs font-medium text-[#9b2c2c]" onClick={() => openCampaign(item, "failed")}>
                            Not sent
                          </button>
                          <button type="button" className="rounded-full bg-[#f0f2f5] px-3 py-1 text-xs font-medium" onClick={() => openCampaign(item)}>Edit</button>
                          <button type="button" className="rounded-full bg-[#fff1f0] px-3 py-1 text-xs font-medium text-[#9b2c2c]" onClick={() => deleteCampaign(item.id)}>Delete</button>
                        </div>
                      </div>
                    ))}
                    {campaigns.length === 0 ? <p className="text-sm text-[#667781]">No campaigns yet. Name one, write the message, add a poster, then save or send it to every waiting lead.</p> : null}
                  </div>
                </section>
              </div>
            </div>
          )}
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
                <>
                  <button type="button" className={chip(false)} onClick={() => setMode("automation")}>
                    Bulk
                  </button>
                  <button type="button" className={chip(false)} onClick={() => setMode("clicks")}>
                    Click leads
                  </button>
                </>
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
                  {selectedPoster?.url ? (
                    <div className="mb-2 flex items-center gap-2">
                      <img src={selectedPoster.url} alt="" className="h-14 w-14 rounded-lg object-cover" />
                      <span className="text-xs text-[#667781]">This poster is sent with the reply.</span>
                      <button type="button" className="text-xs font-medium text-[#9b2c2c]" onClick={() => setPosterId("")}>Remove</button>
                    </div>
                  ) : null}
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
                {admin ? "Select a chat, or open Bulk messaging and press Send for every waiting lead." : "Bulk messaging is limited to Admin. Select a chat to reply."}
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
