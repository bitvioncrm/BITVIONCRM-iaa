import type { AccessRights, BusinessUnit, LeadSource, LeadStatus, Priority, Role, User } from "@/types";

export const DATA_VERSION = 7;

export const DEMO_EMAIL = "admin@bitvion.demo";
export const DEMO_PASSWORD = "admin123";
export const STAFF_PASSWORD = "staff123";
export const ADMIN_ID = "usr_akhil";

export function accessFor(role: Role): AccessRights {
  if (role === "administrator") {
    return { viewAllLeads: true, assignLeads: true, whatsapp: true, calls: true, campaigns: true, reports: true, manageTeam: true, settings: true };
  }
  if (role === "manager") {
    return { viewAllLeads: true, assignLeads: true, whatsapp: true, calls: true, campaigns: true, reports: true, manageTeam: false, settings: false };
  }
  if (role === "counsellor") {
    return { viewAllLeads: false, assignLeads: false, whatsapp: true, calls: true, campaigns: false, reports: false, manageTeam: false, settings: false };
  }
  return { viewAllLeads: true, assignLeads: false, whatsapp: false, calls: false, campaigns: false, reports: true, manageTeam: false, settings: false };
}

function member(
  id: string,
  name: string,
  email: string,
  phone: string,
  role: Role,
  businessUnit: User["businessUnit"],
  branch: string,
): User {
  return { id, name, email, phone, role, status: "active", businessUnit, branch, access: accessFor(role) };
}

export const USERS: User[] = [
  member(ADMIN_ID, "Akhil Shijo", DEMO_EMAIL, "+914844002100", "administrator", "both", "All branches"),
  member("usr_anu", "Anu Thomas", "anu.thomas@bitvion.demo", "+919847011001", "counsellor", "clinic", "Perumbavoor"),
  member("usr_vishnu", "Vishnu Raj", "vishnu.raj@bitvion.demo", "+919847011002", "counsellor", "clinic", "Perumbavoor"),
  member("usr_sneha", "Sneha Joseph", "sneha.joseph@bitvion.demo", "+919847011003", "counsellor", "clinic", "Perumbavoor"),
  member("usr_rahulm", "Rahul Mathew", "rahul.mathew@bitvion.demo", "+919847011004", "manager", "institute", "Kochi"),
  member("usr_meera", "Meera Menon", "meera.menon@bitvion.demo", "+919847011005", "counsellor", "institute", "Kochi"),
];

export const DEMO_ACCOUNTS = [
  { email: DEMO_EMAIL, password: DEMO_PASSWORD, userId: ADMIN_ID },
  { email: "admin@recruitflow.demo", password: DEMO_PASSWORD, userId: ADMIN_ID },
  { email: "anu.thomas@bitvion.demo", password: STAFF_PASSWORD, userId: "usr_anu" },
  { email: "vishnu.raj@bitvion.demo", password: STAFF_PASSWORD, userId: "usr_vishnu" },
  { email: "rahul.mathew@bitvion.demo", password: STAFF_PASSWORD, userId: "usr_rahulm" },
  { email: "meera.menon@bitvion.demo", password: STAFF_PASSWORD, userId: "usr_meera" },
];

export const CLINIC = {
  name: "Dr. K's Aesthetic Clinic",
  hours: "Monday to Saturday, 9:30 AM – 6:00 PM. Closed on Sundays. Appointments are recommended.",
  branches: [
    { name: "Perumbavoor", address: "Arakkappady, Vengola, Ernakulam", phone: "+91 85928 61517" },
  ],
};

export const INSTITUTE = {
  name: "Institute of Advanced Aesthetics (IAA Kochi)",
  focus: "Clinical aesthetic and semi-permanent makeup training for medical and healthcare professionals.",
  place: "Kochi, Kerala",
};

export const OFFERINGS: Array<{ position: string; category: string; unit: BusinessUnit; campaignId: string }> = [
  { position: "HydraFacial", category: "Facial aesthetics", unit: "clinic", campaignId: "meta_facial" },
  { position: "Botox and fillers", category: "Facial aesthetics", unit: "clinic", campaignId: "meta_facial" },
  { position: "Microneedling", category: "Skin care", unit: "clinic", campaignId: "meta_skin" },
  { position: "Laser tattoo and wart removal", category: "Skin care", unit: "clinic", campaignId: "meta_skin" },
  { position: "Dental implant", category: "Dental care", unit: "clinic", campaignId: "meta_dental" },
  { position: "Teeth whitening", category: "Dental care", unit: "clinic", campaignId: "meta_dental" },
  { position: "Tooth-coloured filling", category: "Dental care", unit: "clinic", campaignId: "meta_dental" },
  { position: "PRP hair therapy", category: "Hair restoration", unit: "clinic", campaignId: "meta_hair" },
  { position: "Clinical aesthetics certificate", category: "Institute", unit: "institute", campaignId: "meta_iaa" },
  { position: "Semi-permanent makeup", category: "Institute", unit: "institute", campaignId: "meta_spm" },
  { position: "Advanced skin studio", category: "Institute", unit: "institute", campaignId: "meta_iaa" },
  { position: "Career masterclass", category: "Institute", unit: "institute", campaignId: "meta_master" },
];

export const POSITIONS = OFFERINGS.map(({ position, category }) => ({ position, category }));

export const META_CAMPAIGNS = [
  { id: "meta_facial", name: "Facial aesthetics – Perumbavoor", unit: "clinic" as const, branch: "Perumbavoor", form: "Appointment enquiry" },
  { id: "meta_skin", name: "Skin treatments – Perumbavoor", unit: "clinic" as const, branch: "Perumbavoor", form: "Treatment enquiry" },
  { id: "meta_dental", name: "Dental care – Perumbavoor", unit: "clinic" as const, branch: "Perumbavoor", form: "Dental consultation" },
  { id: "meta_hair", name: "PRP hair – Perumbavoor", unit: "clinic" as const, branch: "Perumbavoor", form: "Hair consultation" },
  { id: "meta_iaa", name: "IAA clinical training – Kochi", unit: "institute" as const, branch: "Kochi", form: "Course enquiry" },
  { id: "meta_spm", name: "Semi-permanent makeup course", unit: "institute" as const, branch: "Kochi", form: "Course enquiry" },
  { id: "meta_master", name: "IAA free career masterclass", unit: "institute" as const, branch: "Kochi", form: "Masterclass registration" },
];

export function campaignById(id: string) {
  return META_CAMPAIGNS.find((item) => item.id === id) ?? META_CAMPAIGNS[0];
}

export function offeringFor(position: string) {
  return OFFERINGS.find((item) => item.position === position) ?? OFFERINGS[position.length % OFFERINGS.length] ?? OFFERINGS[0]!;
}

export const CITIES = [
  "Thodupuzha",
  "Perumbavoor",
  "Kothamangalam",
  "Muvattupuzha",
  "Kochi",
  "Vengola",
  "Kolani",
  "Aluva",
  "Kottayam",
  "Ernakulam",
  "Muvattupuzha",
  "Adimali",
];

export const FIRST_NAMES = [
  "Rahul", "Anjali", "Muhammed", "Sneha", "Arjun", "Neha", "Vishnu", "Fathima", "Amal", "Meera",
  "Nikhil", "Aisha", "Devika", "Harish", "Lakshmi", "Naveen", "Priya", "Ravi", "Sanjay", "Deepa",
  "Kiran", "Reshma", "Jithin", "Sandra", "Aditya", "Nandana", "Farhan", "Liya", "Basil", "Ann",
  "George", "Mariya", "Ashwin", "Diya", "Rohan", "Pooja", "Irfan", "Aswathy", "Joel", "Hanna",
];

export const LAST_NAMES = [
  "Kumar", "Thomas", "Shamil", "Joseph", "Nair", "Varghese", "Raj", "Basheer", "Menon", "Pillai",
  "Krishnan", "Mathew", "George", "Das", "Iyer", "Reddy", "Shah", "Khan", "Ali", "Babu",
  "Varma", "Prasad", "Kurian", "Antony", "Balan", "Mohan", "Iqbal", "Fernandes", "Dsouza", "Shaji",
  "Panicker", "Hameed",
];

export const FEMALE_NAMES = new Set([
  "Anjali", "Sneha", "Neha", "Fathima", "Meera", "Aisha", "Devika", "Lakshmi", "Priya", "Deepa",
  "Reshma", "Sandra", "Nandana", "Liya", "Ann", "Mariya", "Diya", "Pooja", "Aswathy", "Hanna",
]);

export const STATUS_ORDER: LeadStatus[] = [
  "excel",
  "new",
  "contacted",
  "interested",
  "follow_up",
  "documents_pending",
  "processing",
  "interview",
  "selected",
  "converted",
  "lost",
];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  excel: "Excel",
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow-up",
  documents_pending: "Details Pending",
  processing: "In Progress",
  interview: "Consultation",
  selected: "Booked",
  converted: "Converted",
  lost: "Lost",
};

const STAGE_ALIASES: Record<string, LeadStatus> = {
  details_pending: "documents_pending",
  detail_pending: "documents_pending",
  in_progress: "processing",
  consultation: "interview",
  booked: "selected",
  won: "converted",
  closed_won: "converted",
  converted: "converted",
};

export function stageFromText(value: string): LeadStatus {
  const raw = value.trim().toLowerCase();
  if (!raw) return "new";
  const compact = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (compact in STATUS_LABEL) return compact as LeadStatus;
  if (compact in STAGE_ALIASES) return STAGE_ALIASES[compact];
  const labeled = (Object.entries(STATUS_LABEL) as Array<[LeadStatus, string]>).find(([, label]) => label.toLowerCase() === raw);
  return labeled?.[0] ?? "new";
}

export const STATUS_CLASS: Record<LeadStatus, string> = {
  excel: "bg-slate-100 text-slate-600",
  new: "bg-slate-100 text-slate-700",
  contacted: "bg-blue-50 text-blue-800",
  interested: "bg-emerald-50 text-emerald-800",
  follow_up: "bg-amber-50 text-amber-800",
  documents_pending: "bg-orange-50 text-orange-800",
  processing: "bg-indigo-50 text-indigo-800",
  interview: "bg-violet-50 text-violet-800",
  selected: "bg-teal-50 text-teal-800",
  converted: "bg-emerald-100 text-emerald-900",
  lost: "bg-red-50 text-red-700",
};

export const SOURCE_LABEL: Record<LeadSource, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  referral: "Referral",
  walk_in: "Walk-in",
  meta_ads: "Meta Ads",
  other: "Other",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_CLASS: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-50 text-blue-700",
  high: "bg-amber-50 text-amber-800",
  urgent: "bg-red-50 text-red-700",
};

export const ROLE_LABEL: Record<Role, string> = {
  administrator: "Administrator",
  manager: "Manager",
  counsellor: "Counsellor",
  viewer: "Viewer",
};

export const FOLLOW_UP_LABEL = {
  whatsapp: "WhatsApp",
  call: "Call",
  email: "Email",
  document_reminder: "Document Reminder",
  interview_reminder: "Interview Reminder",
  general: "General",
} as const;

export const PIPELINE_COLUMNS: Array<{ id: LeadStatus; title: string }> = [
  { id: "new", title: "New" },
  { id: "contacted", title: "Contacted" },
  { id: "interested", title: "Interested" },
  { id: "follow_up", title: "Follow-up" },
  { id: "documents_pending", title: "Details Pending" },
  { id: "processing", title: "In Progress" },
  { id: "interview", title: "Consultation" },
  { id: "selected", title: "Booked" },
  { id: "converted", title: "Converted" },
  { id: "lost", title: "Lost" },
];

export function canWrite(role: Role) {
  return role !== "viewer";
}

export function canDelete(role: Role) {
  return role === "administrator" || role === "manager";
}

export function canManageSettings(role: Role) {
  return role === "administrator";
}

export function canManageTeam(role: Role) {
  return role === "administrator";
}
