export type Role = "administrator" | "manager" | "counsellor" | "viewer";

export type BusinessUnit = "clinic" | "institute";

export interface AccessRights {
  viewAllLeads: boolean;
  assignLeads: boolean;
  whatsapp: boolean;
  calls: boolean;
  campaigns: boolean;
  reports: boolean;
  manageTeam: boolean;
  settings: boolean;
}

export type LeadStatus =
  | "excel"
  | "new"
  | "contacted"
  | "interested"
  | "follow_up"
  | "documents_pending"
  | "processing"
  | "interview"
  | "selected"
  | "converted"
  | "lost";

export type LeadSource =
  | "website"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "google"
  | "referral"
  | "walk_in"
  | "meta_ads"
  | "other";

export type Priority = "low" | "medium" | "high" | "urgent";

export type FollowUpType =
  | "whatsapp"
  | "call"
  | "email"
  | "document_reminder"
  | "interview_reminder"
  | "general";

export type TaskStatus = "pending" | "in_progress" | "completed";

export type ActivityType =
  | "lead_created"
  | "status_changed"
  | "assigned"
  | "whatsapp"
  | "follow_up"
  | "task"
  | "campaign"
  | "note"
  | "converted"
  | "deleted"
  | "imported"
  | "call"
  | "email";

export type CampaignAudience =
  | "all"
  | "new"
  | "interested"
  | "pending_follow_up"
  | "documents_pending"
  | "custom";

export type AutomationNodeType = "trigger" | "delay" | "condition" | "action";

export type DateRangeKey = "today" | "week" | "month";

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: "active" | "inactive";
  businessUnit: BusinessUnit | "both";
  branch: string;
  access: AccessRights;
}

export interface LeadDocument {
  id: string;
  name: string;
  status: "received" | "pending" | "rejected";
}

export interface LeadNote {
  id: string;
  body: string;
  userId: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  fullName: string;
  phone: string;
  whatsapp: string;
  email: string;
  gender: "male" | "female" | "other";
  age: number;
  location: string;
  country: string;
  position: string;
  jobCategory: string;
  experience: string;
  source: LeadSource;
  priority: Priority;
  assignedTo: string;
  status: LeadStatus;
  notes: string;
  tags: string[];
  documents: LeadDocument[];
  noteEntries: LeadNote[];
  createdAt: string;
  updatedAt: string;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  convertedAt: string | null;
  businessUnit: BusinessUnit;
  metaCampaignId: string;
  metaCampaignName: string;
  whatsappAutomation: boolean;
  callCount: number;
  talkSeconds: number;
}

export interface CallLog {
  id: string;
  leadId: string;
  userId: string;
  startedAt: string;
  durationSeconds: number;
  notes: string;
}

export interface Activity {
  id: string;
  at: string;
  userId: string;
  leadId: string | null;
  leadName: string | null;
  type: ActivityType;
  action: string;
  details: string;
}

export interface FollowUp {
  id: string;
  leadId: string;
  assignedTo: string;
  type: FollowUpType;
  dueAt: string;
  status: "pending" | "completed";
  notes: string;
  createdAt: string;
  completedAt: string | null;
}

export interface Task {
  id: string;
  title: string;
  leadId: string | null;
  assignedTo: string;
  priority: Priority;
  dueAt: string;
  taskType: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
}

export interface WhatsAppConversation {
  id: string;
  leadId: string;
  unread: number;
  updatedAt: string;
}

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  leadId: string;
  direction: "in" | "out";
  body: string;
  status: "sent" | "delivered" | "read" | "failed";
  templateId: string | null;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  key: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  audience: CampaignAudience;
  templateId: string;
  leadIds: string[];
  schedule: "now" | "later";
  scheduledAt: string | null;
  status: "draft" | "scheduled" | "sending" | "completed";
  recipients: number;
  successful: number;
  pending: number;
  failed: number;
  createdAt: string;
  messagePreview: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
}

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  title: string;
  description: string;
  hours?: number;
  branch?: "yes" | "no";
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  runOnNewLeads: boolean;
  nodes: AutomationNode[];
}

export interface Job {
  id: string;
  title: string;
  location: string;
  category: string;
  openings: number;
  status: "open" | "closed";
}

export interface AppSettings {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  website: string;
  address: string;
  timezone: string;
  whatsapp: {
    accountName: string;
    phoneNumber: string;
    businessId: string;
    apiStatus: "demo";
  };
  meta: {
    connected: boolean;
    accountName: string;
    adAccountId: string;
    pageName: string;
    status: "demo";
  };
  notifications: {
    followUps: boolean;
    replies: boolean;
    campaigns: boolean;
    overdue: boolean;
  };
}

export interface CrmState {
  version: number;
  users: User[];
  leads: Lead[];
  activities: Activity[];
  followUps: FollowUp[];
  tasks: Task[];
  conversations: WhatsAppConversation[];
  messages: WhatsAppMessage[];
  templates: Template[];
  campaigns: Campaign[];
  notifications: NotificationItem[];
  automation: Automation;
  jobs: Job[];
  settings: AppSettings;
  calls: CallLog[];
}

export interface LeadInput {
  fullName: string;
  phone: string;
  whatsapp: string;
  email: string;
  gender: "male" | "female" | "other";
  age: number;
  location: string;
  country: string;
  position: string;
  jobCategory: string;
  experience: string;
  source: LeadSource;
  priority: Priority;
  assignedTo: string;
  status: LeadStatus;
  notes: string;
  tags: string[];
  businessUnit?: BusinessUnit;
  metaCampaignId?: string;
  metaCampaignName?: string;
}
