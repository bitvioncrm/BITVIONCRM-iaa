import {
  BarChart3,
  Building2,
  CalendarClock,
  CheckSquare,
  ContactRound,
  FileText,
  GraduationCap,
  Kanban,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Package,
  Phone,
  Radio,
  Receipt,
  ScrollText,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { pathsForRole } from "@/lib/production-access";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end: boolean;
}

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/desk", label: "My desk", icon: ContactRound, end: false },
  { to: "/leads", label: "Leads", icon: Users, end: false },
  { to: "/pipeline", label: "Pipeline", icon: Kanban, end: false },
  { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock, end: false },
  { to: "/calls", label: "Calls", icon: Phone, end: false },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, end: false },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone, end: false },
  { to: "/templates", label: "Templates", icon: FileText, end: false },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, end: false },
  { to: "/reports", label: "Reports", icon: BarChart3, end: false },
  { to: "/team", label: "Team", icon: UsersRound, end: false },
  { to: "/activity", label: "Activity", icon: ScrollText, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Business Overview", icon: LayoutDashboard, end: true },
      { to: "/clinic", label: "Clinic", icon: Building2, end: false },
      { to: "/institute", label: "Institute", icon: GraduationCap, end: false },
      { to: "/meta", label: "Meta Lead Centre", icon: Radio, end: false },
    ],
  },
  {
    label: "CRM",
    items: [
      { to: "/desk", label: "My desk", icon: ContactRound, end: false },
      { to: "/leads", label: "CRM & Leads", icon: Users, end: false },
      { to: "/pipeline", label: "Pipeline", icon: Kanban, end: false },
      { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock, end: false },
      { to: "/calls", label: "Calls", icon: Phone, end: false },
      { to: "/campaigns", label: "Campaigns", icon: Megaphone, end: false },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/inventory", label: "Inventory", icon: Package, end: false },
      { to: "/billing", label: "Finance", icon: Receipt, end: false },
      { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, end: false },
      { to: "/templates", label: "Templates", icon: FileText, end: false },
      { to: "/tasks", label: "Tasks", icon: CheckSquare, end: false },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/reports", label: "Reports & Analytics", icon: BarChart3, end: false },
      { to: "/team", label: "Team & Permissions", icon: UsersRound, end: false },
      { to: "/activity", label: "Activity & Audit", icon: ScrollText, end: false },
      { to: "/settings", label: "Settings", icon: Settings, end: false },
    ],
  },
];

export const STAFF_NAV = NAV_ITEMS.filter((item) => ["/", "/leads", "/calls", "/whatsapp"].includes(item.to));

export const MOBILE_NAV = [NAV_ITEMS[0], NAV_ITEMS[2], NAV_ITEMS[5], NAV_ITEMS[6]] as const;

export const ADMIN_ONLY_PREFIXES = ["/desk", "/pipeline", "/follow-ups", "/campaigns", "/templates", "/tasks", "/reports", "/team", "/activity", "/settings", "/meta", "/inventory", "/billing", "/institute"];

export function productionGroups(roleKey: string) {
  const allowed = new Set(pathsForRole(roleKey));
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => allowed.has(item.to)),
  })).filter((group) => group.items.length > 0);
}

export function productionNav(roleKey: string) {
  return productionGroups(roleKey).flatMap((group) => group.items);
}
