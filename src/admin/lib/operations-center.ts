export type OperationTaskSource = "operation_tasks" | "operation_checklist_items";
export type OperationPriority = "low" | "medium" | "high" | "critical";
export type OperationStatus = "todo" | "in_progress" | "waiting" | "completed" | "cancelled";
export type OperationQuickFilter = "today" | "overdue" | "critical" | "backlog" | "unassigned" | "mine" | "all";
export type OperationGroupView = "priorities" | "trips" | "bookings";
export type OperationDueBucket = "today" | "overdue_1_7" | "overdue_8_30" | "backlog" | "no_deadline" | "upcoming";

export type NormalizedOperationTask = {
  id: string;
  sourceTable: OperationTaskSource;
  title: string;
  description?: string | null;
  category: string;
  priority: OperationPriority;
  status: OperationStatus;
  assignedTo?: string | null;
  deadline?: string | null;
  completedAt?: string | null;
  bookingId?: string | null;
  tripId?: string | null;
  visaApplicationId?: string | null;
  clientId?: string | null;
  bookingReference?: string | null;
  clientName?: string | null;
  tripTitle?: string | null;
  checklistTitle?: string | null;
  href: string;
};

export type TaskMutation = "status" | "assign" | "deadline" | "cancel";

export const ACTIVE_OPERATION_STATUSES = new Set<OperationStatus>(["todo", "in_progress", "waiting"]);

export const operationPriorityLabels: Record<OperationPriority, string> = {
  critical: "Critique",
  high: "Haute",
  medium: "Moyenne",
  low: "Faible",
};

export const operationStatusLabels: Record<OperationStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  waiting: "En attente",
  completed: "Terminée",
  cancelled: "Annulée",
};

export const operationCategoryLabels: Record<string, string> = {
  general: "Général",
  manual: "Manuel",
  flight: "Vol",
  flight_reservation: "Vol",
  visa: "Visa",
  passport: "Passeport",
  hotel: "Hôtel",
  hotel_rooming: "Hôtel / rooming",
  transport: "Transport",
  airport_transfer: "Transfert",
  final_documents: "Documents",
  insurance: "Assurance",
  jr_pass: "Transport Japon",
};

const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const dayDifference = (later: Date, earlier: Date) =>
  Math.floor((dayStart(later).getTime() - dayStart(earlier).getTime()) / 86_400_000);

export const operationTaskKey = (task: Pick<NormalizedOperationTask, "sourceTable" | "id">) =>
  `${task.sourceTable}:${task.id}`;

export function deduplicateOperationTasks(tasks: NormalizedOperationTask[]) {
  const unique = new Map<string, NormalizedOperationTask>();
  tasks.forEach((task) => {
    const key = operationTaskKey(task);
    if (!unique.has(key)) unique.set(key, task);
  });
  return Array.from(unique.values());
}

export const isActiveOperationTask = (task: Pick<NormalizedOperationTask, "status">) =>
  ACTIVE_OPERATION_STATUSES.has(task.status);

export const isOperationTaskDueToday = (task: Pick<NormalizedOperationTask, "deadline" | "status">, now = new Date()) => {
  if (!task.deadline || !isActiveOperationTask(task)) return false;
  return dayDifference(new Date(task.deadline), now) === 0;
};

export const isOperationTaskOverdue = (task: Pick<NormalizedOperationTask, "deadline" | "status">, now = new Date()) =>
  Boolean(task.deadline && isActiveOperationTask(task) && new Date(task.deadline).getTime() < now.getTime());

export const operationTaskOverdueDays = (task: Pick<NormalizedOperationTask, "deadline">, now = new Date()) => {
  if (!task.deadline) return 0;
  return Math.max(0, dayDifference(now, new Date(task.deadline)));
};

export function operationTaskDueBucket(task: Pick<NormalizedOperationTask, "deadline" | "status">, now = new Date()): OperationDueBucket {
  if (!task.deadline) return "no_deadline";
  if (isOperationTaskDueToday(task, now)) return "today";
  if (!isOperationTaskOverdue(task, now)) return "upcoming";
  const age = operationTaskOverdueDays(task, now);
  if (age > 30) return "backlog";
  if (age > 7) return "overdue_8_30";
  return "overdue_1_7";
}

export const isOperationTaskBacklog = (task: Pick<NormalizedOperationTask, "deadline" | "status">, now = new Date()) =>
  isActiveOperationTask(task) && operationTaskDueBucket(task, now) === "backlog";

export function operationTaskPriorityRank(task: NormalizedOperationTask, now = new Date()) {
  const overdue = isOperationTaskOverdue(task, now);
  const today = isOperationTaskDueToday(task, now);
  const backlog = isOperationTaskBacklog(task, now);
  if (!backlog && overdue && task.priority === "critical") return 0;
  if (today && task.priority === "critical") return 1;
  if (!backlog && overdue && task.priority === "high") return 2;
  if (today && task.priority === "high") return 3;
  if (today) return 4;
  if (!backlog && overdue) return 5;
  if (backlog) return 8;
  if (task.priority === "critical") return 6;
  return 7;
}

export const sortOperationTasks = (tasks: NormalizedOperationTask[], now = new Date()) =>
  [...tasks].sort((a, b) => {
    const rank = operationTaskPriorityRank(a, now) - operationTaskPriorityRank(b, now);
    if (rank) return rank;
    const aDue = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
    return aDue - bDue || a.title.localeCompare(b.title, "fr");
  });

export function operationTaskDueLabel(task: Pick<NormalizedOperationTask, "deadline" | "status">, now = new Date()) {
  if (!task.deadline) return "Sans échéance";
  const bucket = operationTaskDueBucket(task, now);
  const days = operationTaskOverdueDays(task, now);
  if (bucket === "today") return "Aujourd’hui";
  if (bucket === "overdue_1_7" || bucket === "overdue_8_30" || bucket === "backlog") return `Retard ${days} j`;
  const until = dayDifference(new Date(task.deadline), now);
  if (until === 1) return "Demain";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(task.deadline));
}

export function taskMatchesQuickFilter(task: NormalizedOperationTask, filter: OperationQuickFilter, currentUserId?: string | null, now = new Date()) {
  if (!isActiveOperationTask(task)) return false;
  if (filter === "today") return isOperationTaskDueToday(task, now);
  if (filter === "overdue") return isOperationTaskOverdue(task, now);
  if (filter === "critical") return task.priority === "critical";
  if (filter === "backlog") return isOperationTaskBacklog(task, now);
  if (filter === "unassigned") return !task.assignedTo;
  if (filter === "mine") return Boolean(currentUserId && task.assignedTo === currentUserId);
  return true;
}

export const taskSupportsMutation = (task: Pick<NormalizedOperationTask, "sourceTable">, mutation: TaskMutation) => {
  const supported: Record<OperationTaskSource, TaskMutation[]> = {
    operation_tasks: ["status", "assign", "deadline", "cancel"],
    operation_checklist_items: ["status", "assign", "deadline", "cancel"],
  };
  return supported[task.sourceTable].includes(mutation);
};

export const tasksSupportMutation = (tasks: NormalizedOperationTask[], mutation: TaskMutation) =>
  tasks.length > 0 && tasks.every((task) => taskSupportsMutation(task, mutation));

export function groupOperationTaskKey(task: NormalizedOperationTask, view: OperationGroupView) {
  if (view === "trips") return task.tripId ? `trip:${task.tripId}` : "trip:none";
  if (view === "bookings") return task.bookingId ? `booking:${task.bookingId}` : "booking:none";
  return `priority:${task.priority}`;
}
