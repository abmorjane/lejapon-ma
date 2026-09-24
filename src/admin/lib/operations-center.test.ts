import { describe, expect, it } from "vitest";
import {
  deduplicateOperationTasks,
  isOperationTaskBacklog,
  isOperationTaskDueToday,
  isOperationTaskOverdue,
  operationTaskPriorityRank,
  sortOperationTasks,
  taskMatchesQuickFilter,
  tasksSupportMutation,
  type NormalizedOperationTask,
} from "./operations-center";

const now = new Date("2026-09-24T12:00:00Z");
const task = (overrides: Partial<NormalizedOperationTask> = {}): NormalizedOperationTask => ({
  id: "task-1",
  sourceTable: "operation_tasks",
  title: "Préparer le dossier",
  category: "general",
  priority: "medium",
  status: "todo",
  href: "/admin/operations-center",
  ...overrides,
});

describe("Operations Center tasks", () => {
  it("déduplique une tâche urgente également présente dans les retards", () => {
    const duplicate = task({ priority: "critical", deadline: "2026-09-23T10:00:00Z" });
    expect(deduplicateOperationTasks([duplicate, { ...duplicate }])).toEqual([duplicate]);
  });

  it("calcule aujourd’hui, le retard et le backlog à plus de 30 jours", () => {
    expect(isOperationTaskDueToday(task({ deadline: "2026-09-24T18:00:00Z" }), now)).toBe(true);
    expect(isOperationTaskOverdue(task({ deadline: "2026-09-23T18:00:00Z" }), now)).toBe(true);
    expect(isOperationTaskBacklog(task({ deadline: "2026-08-20T10:00:00Z" }), now)).toBe(true);
    expect(isOperationTaskBacklog(task({ deadline: "2026-09-01T10:00:00Z" }), now)).toBe(false);
  });

  it("priorise les urgences récentes avant le vieux backlog", () => {
    const backlog = task({ id: "old", priority: "critical", deadline: "2026-07-01T10:00:00Z" });
    const recentCritical = task({ id: "recent", priority: "critical", deadline: "2026-09-23T10:00:00Z" });
    const todayHigh = task({ id: "today", priority: "high", deadline: "2026-09-24T18:00:00Z" });
    expect(operationTaskPriorityRank(recentCritical, now)).toBeLessThan(operationTaskPriorityRank(backlog, now));
    expect(sortOperationTasks([backlog, todayHigh, recentCritical], now).map((row) => row.id)).toEqual(["recent", "today", "old"]);
  });

  it("filtre les tâches assignées à l’utilisateur courant", () => {
    expect(taskMatchesQuickFilter(task({ assignedTo: "staff-1" }), "mine", "staff-1", now)).toBe(true);
    expect(taskMatchesQuickFilter(task({ assignedTo: "staff-2" }), "mine", "staff-1", now)).toBe(false);
    expect(taskMatchesQuickFilter(task({ assignedTo: null }), "unassigned", "staff-1", now)).toBe(true);
  });

  it("n’autorise les actions de masse que pour des sources compatibles", () => {
    expect(tasksSupportMutation([
      task(),
      task({ id: "check-1", sourceTable: "operation_checklist_items" }),
    ], "status")).toBe(true);
    expect(tasksSupportMutation([], "status")).toBe(false);
  });

  it("exclut les statuts terminés des filtres actifs", () => {
    expect(taskMatchesQuickFilter(task({ status: "completed" }), "all", "staff-1", now)).toBe(false);
    expect(taskMatchesQuickFilter(task({ status: "cancelled" }), "critical", "staff-1", now)).toBe(false);
  });
});
