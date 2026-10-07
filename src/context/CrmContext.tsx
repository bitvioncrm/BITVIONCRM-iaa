import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { canWrite } from "@/data/catalog";
import { freshCrm, idleCrm, loadCrm, saveCrm } from "@/services/storage";
import {
  addCampaign,
  addFollowUp,
  addLead,
  addNote,
  addTask,
  bulkAssign,
  bulkFollowUp,
  bulkStatus,
  bulkTag,
  completeFollowUp,
  deleteLeads,
  deleteUser,
  deleteTask,
  deleteTemplate,
  duplicateTemplate,
  finishCampaign,
  importLeads,
  logCommunication,
  markAllNotifications,
  markConversationRead,
  markNotification,
  progressCampaign,
  rescheduleFollowUp,
  saveTemplate,
  saveUser,
  sendWhatsApp,
  setLeadStatus,
  simulateReply,
  updateAutomation,
  updateDocument,
  updateLead,
  updateSettings,
  updateTask,
} from "@/services/mutations";
import type { Campaign, CrmState, FollowUpType, LeadInput, LeadStatus, Task, Template } from "@/types";

interface CrmValue {
  state: CrmState;
  actorId: string;
  readonlyMode: boolean;
  addLead: (input: LeadInput) => string | null;
  updateLead: (id: string, input: LeadInput) => string | null;
  setStatus: (id: string, status: LeadStatus) => void;
  removeLeads: (ids: string[]) => void;
  assignLeads: (ids: string[], userId: string) => void;
  changeStatus: (ids: string[], status: LeadStatus) => void;
  tagLeads: (ids: string[], tag: string) => void;
  createFollowUps: (ids: string[], type: FollowUpType, dueAt: string, notes: string) => void;
  createFollowUp: (input: { leadId: string; type: FollowUpType; dueAt: string; notes: string }) => void;
  completeFollowUp: (id: string) => void;
  rescheduleFollowUp: (id: string, dueAt: string) => void;
  sendWhatsApp: (input: { leadId: string; body: string; templateId?: string | null; fail?: boolean }) => boolean;
  broadcastWhatsApp: (inputs: Array<{ leadId: string; body: string }>) => number;
  simulateReply: (leadId: string, body?: string) => void;
  markRead: (leadId: string) => void;
  saveTask: (input: Omit<Task, "id" | "createdAt">, id?: string) => void;
  removeTask: (id: string) => void;
  setTaskStatus: (id: string, status: Task["status"]) => void;
  saveTemplate: (input: { id?: string; name: string; key: string; body: string }) => Template | null;
  duplicateTemplate: (id: string) => void;
  removeTemplate: (id: string) => void;
  createCampaign: (input: Omit<Campaign, "id" | "createdAt" | "successful" | "pending" | "failed" | "status" | "recipients">) => Campaign | null;
  tickCampaign: (id: string, patch: Partial<Pick<Campaign, "successful" | "pending" | "failed" | "status">>) => void;
  finishCampaign: (id: string, deliveredLeadIds: string[], templateBody: string) => void;
  importLeads: (inputs: LeadInput[]) => { created: number; duplicates: number };
  addNote: (leadId: string, body: string) => void;
  updateDocument: (leadId: string, documentId: string, status: CrmState["leads"][number]["documents"][number]["status"]) => void;
  logCall: (leadId: string, body: string, durationSeconds: number) => void;
  removeUser: (id: string) => void;
  logEmail: (leadId: string, body: string) => void;
  saveUser: (input: Parameters<typeof saveUser>[1]) => string | null;
  markNotification: (id: string) => void;
  markAllRead: () => void;
  updateAutomation: (patch: Parameters<typeof updateAutomation>[1]) => void;
  updateSettings: (settings: CrmState["settings"]) => void;
  resetDemo: () => void;
}

const CrmContext = createContext<CrmValue | null>(null);

export function CrmProvider({ children }: { children: ReactNode }) {
  const { session, previewRole, productionUser } = useAuth();
  const actorId = session?.userId ?? "";
  const [state, setState] = useState<CrmState>(() => (productionUser ? idleCrm() : loadCrm()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const readonlyMode = !canWrite(previewRole);

  useEffect(() => {
    if (productionUser) return;
    const timer = window.setTimeout(() => saveCrm(state), 150);
    return () => window.clearTimeout(timer);
  }, [productionUser, state]);

  const api = useMemo<CrmValue>(() => {
    const guard = () => {
      if (readonlyMode) {
        toast.error("Viewers have read-only access.");
        return true;
      }
      return false;
    };
    const commit = (next: CrmState) => {
      stateRef.current = next;
      setState(next);
    };

    return {
      state,
      actorId,
      readonlyMode,
      addLead: (input) => {
        if (guard()) return "Read only";
        const outcome = addLead(stateRef.current, input, actorId);
        commit(outcome.state);
        if (outcome.error || !outcome.result) {
          toast.error(outcome.error ?? "Could not create the lead.");
          return outcome.error ?? "Could not create the lead.";
        }
        toast.success(`${outcome.result.fullName} added to the pipeline.`);
        return null;
      },
      updateLead: (id, input) => {
        if (guard()) return "Read only";
        const outcome = updateLead(stateRef.current, id, input, actorId);
        commit(outcome.state);
        if (outcome.error || !outcome.result) {
          toast.error(outcome.error ?? "Could not update the lead.");
          return outcome.error ?? "Could not update the lead.";
        }
        toast.success("Lead updated.");
        return null;
      },
      setStatus: (id, status) => {
        if (guard()) return;
        const outcome = setLeadStatus(stateRef.current, id, status, actorId);
        commit(outcome.state);
        if (outcome.error) toast.error(outcome.error);
        else if (outcome.result) toast.success(`${outcome.result.fullName} moved to ${status.replaceAll("_", " ")}.`);
      },
      removeLeads: (ids) => {
        if (guard()) return;
        commit(deleteLeads(stateRef.current, ids, actorId));
        toast.success(ids.length === 1 ? "Lead deleted." : `${ids.length} leads deleted.`);
      },
      assignLeads: (ids, userId) => {
        if (guard()) return;
        commit(bulkAssign(stateRef.current, ids, userId, actorId));
        toast.success("Leads reassigned.");
      },
      changeStatus: (ids, status) => {
        if (guard()) return;
        commit(bulkStatus(stateRef.current, ids, status, actorId));
        toast.success("Status updated.");
      },
      tagLeads: (ids, tag) => {
        if (guard()) return;
        commit(bulkTag(stateRef.current, ids, tag));
        toast.success(`Tag “${tag}” added.`);
      },
      createFollowUps: (ids, type, dueAt, notes) => {
        if (guard()) return;
        commit(bulkFollowUp(stateRef.current, ids, type, dueAt, notes, actorId));
        toast.success(ids.length === 1 ? "Follow-up scheduled." : `${ids.length} follow-ups scheduled.`);
      },
      createFollowUp: (input) => {
        if (guard()) return;
        const outcome = addFollowUp(stateRef.current, input, actorId);
        commit(outcome.state);
        if (outcome.error) toast.error(outcome.error);
        else toast.success("Follow-up scheduled.");
      },
      completeFollowUp: (id) => {
        if (guard()) return;
        commit(completeFollowUp(stateRef.current, id, actorId));
        toast.success("Follow-up completed.");
      },
      rescheduleFollowUp: (id, dueAt) => {
        if (guard()) return;
        commit(rescheduleFollowUp(stateRef.current, id, dueAt, actorId));
        toast.success("Follow-up rescheduled.");
      },
      sendWhatsApp: (input) => {
        if (guard()) return false;
        const outcome = sendWhatsApp(stateRef.current, { ...input, actorId });
        commit(outcome.state);
        if (outcome.error) {
          toast.error(outcome.error);
          return false;
        }
        const template = stateRef.current.templates.find((item) => item.id === input.templateId);
        toast.success(
          template?.key === "WELCOME_MESSAGE"
            ? "Welcome message sent in demo mode. A follow-up was scheduled for tomorrow at 10:00 AM."
            : "Message added in demo mode. Nothing was sent through WhatsApp.",
        );
        return true;
      },
      broadcastWhatsApp: (inputs) => {
        if (guard()) return 0;
        let next = stateRef.current;
        let sent = 0;
        inputs.forEach((input) => {
          const outcome = sendWhatsApp(next, { ...input, actorId });
          next = outcome.state;
          if (!outcome.error) sent += 1;
        });
        commit(next);
        toast.success(sent === 1 ? "Message added in demo mode." : `Demo message sent to ${sent} leads. Nothing left this browser.`);
        return sent;
      },
      simulateReply: (leadId, body) => {
        const outcome = simulateReply(stateRef.current, leadId, body ?? "", actorId);
        commit(outcome.state);
        if (outcome.error) toast.error(outcome.error);
        else toast.success("Simulated candidate reply added.");
      },
      markRead: (leadId) => commit(markConversationRead(stateRef.current, leadId)),
      saveTask: (input, id) => {
        if (guard()) return;
        if (id) {
          commit(updateTask(stateRef.current, id, input, actorId));
          toast.success("Task updated.");
          return;
        }
        commit(addTask(stateRef.current, input, actorId).state);
        toast.success("Task created.");
      },
      removeTask: (id) => {
        if (guard()) return;
        commit(deleteTask(stateRef.current, id));
        toast.success("Task deleted.");
      },
      setTaskStatus: (id, status) => {
        if (guard()) return;
        commit(updateTask(stateRef.current, id, { status }, actorId));
        toast.success("Task updated.");
      },
      saveTemplate: (input) => {
        if (guard()) return null;
        const outcome = saveTemplate(stateRef.current, input);
        commit(outcome.state);
        if (outcome.error || !outcome.result) {
          toast.error(outcome.error ?? "Could not save the template.");
          return null;
        }
        toast.success(input.id ? "Template updated." : "Template created.");
        return outcome.result;
      },
      duplicateTemplate: (id) => {
        if (guard()) return;
        const outcome = duplicateTemplate(stateRef.current, id);
        commit(outcome.state);
        if (outcome.error) toast.error(outcome.error);
        else toast.success("Template duplicated.");
      },
      removeTemplate: (id) => {
        if (guard()) return;
        commit(deleteTemplate(stateRef.current, id));
        toast.success("Template deleted.");
      },
      createCampaign: (input) => {
        if (guard()) return null;
        const outcome = addCampaign(stateRef.current, input, actorId);
        commit(outcome.state);
        return outcome.result;
      },
      tickCampaign: (id, patch) => commit(progressCampaign(stateRef.current, id, patch)),
      finishCampaign: (id, deliveredLeadIds, templateBody) => {
        commit(finishCampaign(stateRef.current, id, actorId, deliveredLeadIds, templateBody));
        toast.success("Campaign completed in demo mode.");
      },
      importLeads: (inputs) => {
        if (guard()) return { created: 0, duplicates: inputs.length };
        const outcome = importLeads(stateRef.current, inputs, actorId);
        commit(outcome.state);
        toast.success(`${outcome.created.length} leads imported.`);
        return { created: outcome.created.length, duplicates: outcome.duplicates.length };
      },
      addNote: (leadId, body) => {
        if (guard()) return;
        commit(addNote(stateRef.current, leadId, body, actorId));
        toast.success("Note added.");
      },
      updateDocument: (leadId, documentId, status) => {
        if (guard()) return;
        commit(updateDocument(stateRef.current, leadId, documentId, status, actorId));
        toast.success("Document updated.");
      },
      logCall: (leadId, body, durationSeconds) => {
        if (guard()) return;
        commit(logCommunication(stateRef.current, leadId, "call", body, actorId, durationSeconds));
        toast.success("Call logged in demo mode.");
      },
      removeUser: (id) => {
        if (previewRole !== "administrator") {
          toast.error("Only administrators can remove team members.");
          return;
        }
        const outcome = deleteUser(stateRef.current, id, actorId);
        if (outcome.error) {
          toast.error(outcome.error);
          return;
        }
        commit(outcome.state);
        toast.success("Team member removed. Their leads are back in the fresh queue.");
      },
      logEmail: (leadId, body) => {
        if (guard()) return;
        commit(logCommunication(stateRef.current, leadId, "email", body, actorId));
        toast.success("Email logged in demo mode.");
      },
      saveUser: (input) => {
        if (previewRole !== "administrator") {
          toast.error("Only administrators can manage team access.");
          return "Forbidden";
        }
        const outcome = saveUser(stateRef.current, input);
        commit(outcome.state);
        if (outcome.error) {
          toast.error(outcome.error);
          return outcome.error;
        }
        toast.success(input.id ? "Team member updated." : "Team member added.");
        return null;
      },
      markNotification: (id) => commit(markNotification(stateRef.current, id)),
      markAllRead: () => commit(markAllNotifications(stateRef.current)),
      updateAutomation: (patch) => {
        if (guard()) return;
        commit(updateAutomation(stateRef.current, patch));
      },
      updateSettings: (settings) => {
        if (previewRole === "viewer") {
          toast.error("Viewers cannot change settings.");
          return;
        }
        commit(updateSettings(stateRef.current, settings));
        toast.success("Settings saved.");
      },
      resetDemo: () => {
        const next = freshCrm();
        commit(next);
        toast.success("Demo data restored.");
      },
    };
  }, [actorId, previewRole, readonlyMode, state]);

  return <CrmContext.Provider value={api}>{children}</CrmContext.Provider>;
}

export function useCrm() {
  const context = useContext(CrmContext);
  if (!context) throw new Error("useCrm must be used within CrmProvider");
  return context;
}
