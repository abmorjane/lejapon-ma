import { describe, expect, it } from "vitest";
import {
  actionableDashboardTasks,
  activeBookingRemaining,
  daysUntilDeparture,
  formatDepartureCountdown,
  sortDashboardTasks,
  type DashboardTask,
} from "./dashboard-operations";

const now = new Date("2026-09-24T12:00:00+01:00");
const task = (id: string, priority: string, deadline: string | null): DashboardTask => ({
  id,
  source: "task",
  title: id,
  priority,
  deadline,
  href: "/admin/operations-center",
});

describe("dashboard operational priorities", () => {
  it("sorts critical overdue, critical today, overdue and today in business order", () => {
    const rows = [
      task("today", "medium", "2026-09-24T18:00:00+01:00"),
      task("critical-today", "critical", "2026-09-24T16:00:00+01:00"),
      task("overdue", "high", "2026-09-22T12:00:00+01:00"),
      task("critical-overdue", "critical", "2026-09-20T12:00:00+01:00"),
    ];
    expect(sortDashboardTasks(rows, now).map((row) => row.id)).toEqual([
      "critical-overdue",
      "critical-today",
      "overdue",
      "today",
    ]);
  });

  it("keeps future non-critical work out of the dashboard action queue", () => {
    const rows = [
      task("future", "medium", "2026-10-01T12:00:00+01:00"),
      task("critical", "critical", null),
    ];
    expect(actionableDashboardTasks(rows, now).map((row) => row.id)).toEqual(["critical"]);
  });

  it("computes departure countdowns from calendar days", () => {
    expect(daysUntilDeparture("2026-09-24", now)).toBe(0);
    expect(daysUntilDeparture("2026-09-25", now)).toBe(1);
    expect(formatDepartureCountdown(1)).toBe("Demain");
    expect(formatDepartureCountdown(50)).toBe("J-50");
  });

  it("never exposes a negative remaining balance", () => {
    expect(activeBookingRemaining(30_000, 12_000)).toBe(18_000);
    expect(activeBookingRemaining(30_000, 35_000)).toBe(0);
  });
});
