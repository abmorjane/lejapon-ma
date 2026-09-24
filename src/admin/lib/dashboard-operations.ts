export type DashboardTask = {
  id: string;
  source: "task" | "checklist";
  title: string;
  priority: string;
  deadline?: string | null;
  bookingId?: string | null;
  tripId?: string | null;
  visaApplicationId?: string | null;
  context?: string | null;
  href: string;
};

const localDayKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const isDashboardTaskOverdue = (task: DashboardTask, now = new Date()) =>
  Boolean(task.deadline && new Date(task.deadline).getTime() < now.getTime() && localDayKey(new Date(task.deadline)) !== localDayKey(now));

export const isDashboardTaskDueToday = (task: DashboardTask, now = new Date()) =>
  Boolean(task.deadline && localDayKey(new Date(task.deadline)) === localDayKey(now));

export const dashboardTaskRank = (task: DashboardTask, now = new Date()) => {
  const critical = task.priority === "critical";
  const overdue = isDashboardTaskOverdue(task, now);
  const today = isDashboardTaskDueToday(task, now);
  if (critical && overdue) return 0;
  if (critical && today) return 1;
  if (overdue) return 2;
  if (today) return 3;
  if (critical) return 4;
  return 5;
};

export const sortDashboardTasks = (tasks: DashboardTask[], now = new Date()) =>
  [...tasks].sort((a, b) => {
    const rank = dashboardTaskRank(a, now) - dashboardTaskRank(b, now);
    if (rank) return rank;
    const aDue = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
    return aDue - bDue || a.title.localeCompare(b.title, "fr");
  });

export const actionableDashboardTasks = (tasks: DashboardTask[], now = new Date()) =>
  sortDashboardTasks(tasks, now).filter((task) =>
    task.priority === "critical" || isDashboardTaskOverdue(task, now) || isDashboardTaskDueToday(task, now));

export const daysUntilDeparture = (date: string, now = new Date()) => {
  const departure = new Date(`${date.slice(0, 10)}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((departure.getTime() - today.getTime()) / 86_400_000);
};

export const formatDepartureCountdown = (days: number) => {
  if (days === 0) return "Aujourd’hui";
  if (days === 1) return "Demain";
  return `J-${days}`;
};

export const activeBookingRemaining = (total: number, paid: number) =>
  Math.max(0, Number(total || 0) - Number(paid || 0));
