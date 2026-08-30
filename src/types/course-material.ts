export const courseMaterialTypes = [
  { id: "document", label: "Document" },
  { id: "link", label: "Link / Reference" },
  { id: "lecture", label: "Lecture Slides / Notes" },
  { id: "reading", label: "Reading" },
  { id: "assignment_reference", label: "Assignment Instructions" },
  { id: "syllabus", label: "Syllabus" },
  { id: "other", label: "Other" },
] as const;

export type CourseMaterialType = (typeof courseMaterialTypes)[number]["id"];

export function isCourseMaterialType(value: unknown): value is CourseMaterialType {
  return courseMaterialTypes.some((t) => t.id === value);
}

export type CourseMaterial = {
  id: string;
  courseId: string;
  title: string;
  type: CourseMaterialType;
  url: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  course?: {
    id: string;
    code: string;
    name: string;
    color: string | null;
  } | null;
};

export type CourseMaterialDraft = {
  courseId: string;
  title: string;
  type: CourseMaterialType;
  url?: string | null;
  description?: string | null;
};

export type TaskCourseMaterialLink = {
  id: string;
  taskId: string;
  courseMaterialId: string;
  createdAt: string;
  material: CourseMaterial;
};

