export type Note = {
  id: string;
  title: string;
  body: string;
  taskId: string | null;
  courseId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Attachment = {
  id: string;
  noteId: string | null;
  taskId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

