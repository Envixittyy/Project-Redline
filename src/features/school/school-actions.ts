"use server";

import { revalidatePath } from "next/cache";

import { isIsoDate, isValidTimeZone } from "@/lib/date/day";
import { archiveCourse, createCourse, deleteMeeting, saveMeeting, updateCourse } from "@/services/courses/course-repository";
import { authFailureMessage } from "@/services/supabase/errors";

export type SchoolActionResult = { ok:true } | { ok:false; message:string };
class InvalidSchoolInput extends Error {}
const text = (value:unknown, label:string, max=200) => {
  if (typeof value !== "string" || !value.trim()) throw new InvalidSchoolInput(`${label} is required.`);
  if (value.trim().length > max) throw new InvalidSchoolInput(`${label} is too long.`);
  return value.trim();
};
const optional = (value:unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const id = (value:unknown) => text(value, "The record ID", 100);
function failure(error:unknown):SchoolActionResult {
  if (error instanceof InvalidSchoolInput) return { ok:false, message:error.message };
  const auth = authFailureMessage(error); if (auth) return { ok:false, message:auth };
  console.error("[school] action failed:", error);
  return { ok:false, message:error instanceof Error ? error.message : "School could not be updated." };
}
function refresh(){ revalidatePath("/school"); revalidatePath("/calendar"); revalidatePath("/"); }

export type CourseInput = { code:string; name:string; instructor?:string|null; location?:string|null; color?:string|null };
function courseDraft(input:CourseInput) {
  const color = optional(input?.color);
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new InvalidSchoolInput("Choose a valid course color.");
  return { code:text(input?.code,"Course code",30), name:text(input?.name,"Course name"), instructor:optional(input?.instructor), location:optional(input?.location), color };
}
export async function saveCourseAction(courseId:unknown,input:CourseInput):Promise<SchoolActionResult>{
  try { const draft=courseDraft(input); if (courseId) await updateCourse(id(courseId),draft); else await createCourse(draft); refresh(); return {ok:true}; } catch(error){ return failure(error); }
}
export async function archiveCourseAction(courseId:unknown):Promise<SchoolActionResult>{
  try { await archiveCourse(id(courseId)); refresh(); return {ok:true}; } catch(error){ return failure(error); }
}

export type MeetingInput = { courseId:string; title:string; weekdays:number[]; startDate:string; endDateExclusive?:string|null; startTime:string; endTime:string; timeZone:string; location?:string|null };
export async function saveMeetingAction(meetingId:unknown,input:MeetingInput):Promise<SchoolActionResult>{
  try {
    const weekdays=[...new Set(input?.weekdays)].filter((day)=>Number.isInteger(day)&&day>=0&&day<=6);
    if (!weekdays.length) throw new InvalidSchoolInput("Choose at least one meeting day.");
    if (!isIsoDate(input?.startDate)) throw new InvalidSchoolInput("Choose a valid start date.");
    const endDate=optional(input?.endDateExclusive);
    if (endDate && (!isIsoDate(endDate)||endDate<=input.startDate)) throw new InvalidSchoolInput("The end date must follow the start date.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input?.startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input?.endTime)) throw new InvalidSchoolInput("Choose valid meeting times.");
    if (!isValidTimeZone(input?.timeZone)) throw new InvalidSchoolInput("Choose a valid time zone.");
    await saveMeeting(meetingId ? id(meetingId):null,{ courseId:id(input.courseId), title:text(input.title,"Meeting title"), weekdays, startDate:input.startDate, endDateExclusive:endDate, startTime:input.startTime, endTime:input.endTime, timeZone:input.timeZone, location:optional(input.location) });
    refresh(); return {ok:true};
  } catch(error){ return failure(error); }
}
export async function deleteMeetingAction(meetingId:unknown):Promise<SchoolActionResult>{
  try { await deleteMeeting(id(meetingId)); refresh(); return {ok:true}; } catch(error){ return failure(error); }
}

