export type WorkSessionStatus = "planned" | "completed" | "cancelled";
export type WorkSessionSource = "manual" | "planner";

export type WorkSession = {
  id: string;
  taskId: string;
  startsAt: string;
  endsAt: string;
  status: WorkSessionStatus;
  source: WorkSessionSource;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkSessionDraft = {
  taskId: string;
  startsAt: string;
  endsAt: string;
  source?: WorkSessionSource;
};
