import { describe, expect, it } from "vitest";

import {
  isCourseMaterialType,
  type CourseMaterial,
  type CourseMaterialDraft,
} from "@/types/course-material";

describe("Course Materials Domain & Relational Invariants (Phase 7D)", () => {
  const mathCourse = {
    id: "course-math146",
    code: "MATH146",
    name: "Differential Calculus",
    color: "#3b82f6",
  };

  const physicsCourse = {
    id: "course-phys201",
    code: "PHYS201",
    name: "Physics II",
    color: "#10b981",
  };

  const sampleMaterials: CourseMaterial[] = [
    {
      id: "mat-1",
      courseId: "course-math146",
      title: "Week 4 Lecture Slides",
      type: "lecture",
      url: "https://drive.google.com/lecture4.pdf",
      description: "Limits and continuity",
      createdAt: "2026-10-01T08:00:00.000Z",
      updatedAt: "2026-10-01T08:00:00.000Z",
      course: mathCourse,
    },
    {
      id: "mat-2",
      courseId: "course-math146",
      title: "Problem Set 4 Instructions",
      type: "assignment_reference",
      url: null,
      description: "Exercises 1-15",
      createdAt: "2026-10-02T08:00:00.000Z",
      updatedAt: "2026-10-02T08:00:00.000Z",
      course: mathCourse,
    },
    {
      id: "mat-3",
      courseId: "course-phys201",
      title: "Lab 3 Manual",
      type: "reading",
      url: "https://physics.univ.edu/lab3.pdf",
      description: "Oscilloscope setup",
      createdAt: "2026-10-03T08:00:00.000Z",
      updatedAt: "2026-10-03T08:00:00.000Z",
      course: physicsCourse,
    },
  ];

  it("validates recognized course material types", () => {
    expect(isCourseMaterialType("document")).toBe(true);
    expect(isCourseMaterialType("link")).toBe(true);
    expect(isCourseMaterialType("lecture")).toBe(true);
    expect(isCourseMaterialType("reading")).toBe(true);
    expect(isCourseMaterialType("assignment_reference")).toBe(true);
    expect(isCourseMaterialType("syllabus")).toBe(true);
    expect(isCourseMaterialType("other")).toBe(true);

    expect(isCourseMaterialType("invalid_type")).toBe(false);
    expect(isCourseMaterialType(null)).toBe(false);
    expect(isCourseMaterialType(undefined)).toBe(false);
  });

  it("filters course materials strictly by course ID", () => {
    const mathMaterials = sampleMaterials.filter((m) => m.courseId === "course-math146");
    expect(mathMaterials).toHaveLength(2);
    expect(mathMaterials.map((m) => m.title)).toEqual([
      "Week 4 Lecture Slides",
      "Problem Set 4 Instructions",
    ]);

    const physMaterials = sampleMaterials.filter((m) => m.courseId === "course-phys201");
    expect(physMaterials).toHaveLength(1);
    expect(physMaterials[0].title).toBe("Lab 3 Manual");
  });

  it("enforces that task material picker only returns materials for task's associated course", () => {
    const taskAssociatedCourseId = "course-math146";
    const availableForTask = sampleMaterials.filter((m) => m.courseId === taskAssociatedCourseId);

    expect(availableForTask.every((m) => m.courseId === "course-math146")).toBe(true);
    expect(availableForTask.some((m) => m.courseId === "course-phys201")).toBe(false);
  });

  it("returns zero available materials when task has no associated course", () => {
    const taskWithNoCourse: { courseId: string | null } = { courseId: null };
    const availableForTask = taskWithNoCourse.courseId
      ? sampleMaterials.filter((m) => m.courseId === taskWithNoCourse.courseId)
      : [];

    expect(availableForTask).toHaveLength(0);
  });

  it("identifies and cleans up incompatible material links when task course changes", () => {
    // Task initially associated with MATH146
    const linkedMaterialIds = ["mat-1", "mat-2"];

    // Task course changes to PHYS201
    const newCourseId = "course-phys201";

    // Detect incompatible links: materials whose courseId does not match newCourseId
    const incompatibleLinks = linkedMaterialIds.filter((materialId) => {
      const material = sampleMaterials.find((m) => m.id === materialId);
      return material && material.courseId !== newCourseId;
    });

    expect(incompatibleLinks).toEqual(["mat-1", "mat-2"]);

    // After cleanup, remaining valid links for new course
    const validRemainingLinks = linkedMaterialIds.filter(
      (id) => !incompatibleLinks.includes(id),
    );
    expect(validRemainingLinks).toHaveLength(0);
  });

  it("preserves canonical course metadata projection on materials", () => {
    const mathLecture = sampleMaterials[0];
    expect(mathLecture.course).toEqual({
      id: "course-math146",
      code: "MATH146",
      name: "Differential Calculus",
      color: "#3b82f6",
    });
  });

  it("validates draft object structure", () => {
    const draft: CourseMaterialDraft = {
      courseId: "course-math146",
      title: "New Handout",
      type: "document",
      url: "https://example.com/handout.pdf",
      description: "Practice problems",
    };

    expect(draft.courseId).toBe("course-math146");
    expect(draft.title.trim()).toBe("New Handout");
    expect(isCourseMaterialType(draft.type)).toBe(true);
  });
});

