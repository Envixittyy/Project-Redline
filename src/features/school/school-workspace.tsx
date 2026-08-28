"use client";

import { BookOpen, CalendarPlus, MapPin, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import type { CourseWithMeetings } from "@/types/course";

import { archiveCourseAction, deleteMeetingAction, saveCourseAction, saveMeetingAction } from "./school-actions";
import styles from "./school-workspace.module.css";

const weekdays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export function SchoolWorkspace({ courses, today, timeZone }:{courses:CourseWithMeetings[];today:string;timeZone:string}) {
  const [error,setError]=useState<string|null>(null); const [pending,startTransition]=useTransition();
  const run=(work:()=>Promise<{ok:true}|{ok:false;message:string}>,done?:()=>void)=>startTransition(async()=>{const result=await work();if(result.ok){setError(null);done?.();}else setError(result.message);});
  const [showCourse,setShowCourse]=useState(false); const [meetingCourse,setMeetingCourse]=useState<string|null>(null);
  return <div className={styles.layout}>
    <div className={styles.toolbar}><div><p className={styles.kicker}>Academic timetable</p><h2>{courses.length} active {courses.length===1?"course":"courses"}</h2></div><button onClick={()=>setShowCourse(v=>!v)} type="button"><Plus size={17}/> Add course</button></div>
    {error?<Surface variant="subtle" className={styles.error} role="alert">{error}</Surface>:null}
    {showCourse?<Surface variant="glass" className={styles.formCard}><form onSubmit={(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);run(()=>saveCourseAction(null,{code:String(data.get("code")),name:String(data.get("name")),instructor:String(data.get("instructor")),location:String(data.get("location")),color:String(data.get("color"))}),()=>setShowCourse(false));}}><div className={styles.formGrid}><label>Code<input name="code" maxLength={30} required/></label><label>Name<input name="name" maxLength={200} required/></label><label>Instructor<input name="instructor" maxLength={200}/></label><label>Location<input name="location" maxLength={200}/></label><label>Color<input name="color" type="color" defaultValue="#287ca7"/></label></div><button disabled={pending} type="submit">Save course</button></form></Surface>:null}
    {courses.length===0?<Surface variant="subtle" className={styles.empty}><BookOpen size={24}/><h2>No courses yet</h2><p>Add a course, then attach its weekly meetings. Meetings are projected onto Calendar without creating event rows.</p></Surface>:<div className={styles.courses}>{courses.map(course=><Surface key={course.id} variant="base" className={styles.course} style={{"--course-color":course.color??"var(--accent)"} as React.CSSProperties}><header><span className={styles.swatch}/><div><p>{course.code}</p><h2>{course.name}</h2><small>{[course.instructor,course.location].filter(Boolean).join(" · ")||"No instructor or room yet"}</small></div><button type="button" onClick={()=>setMeetingCourse(meetingCourse===course.id?null:course.id)}><CalendarPlus size={17}/> Meeting</button></header>
      {meetingCourse===course.id?<form className={styles.meetingForm} onSubmit={(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);run(()=>saveMeetingAction(null,{courseId:course.id,title:String(data.get("title")),weekdays:data.getAll("weekdays").map(Number),startDate:String(data.get("startDate")),endDateExclusive:String(data.get("endDate")),startTime:String(data.get("startTime")),endTime:String(data.get("endTime")),timeZone,location:String(data.get("location"))}),()=>setMeetingCourse(null));}}><label>Meeting title<input name="title" defaultValue={course.code} required/></label><fieldset><legend>Days</legend>{weekdays.map((day,index)=><label key={day}><input type="checkbox" name="weekdays" value={index}/>{day}</label>)}</fieldset><div className={styles.formGrid}><label>Starts<input type="date" name="startDate" defaultValue={today} required/></label><label>Ends (optional)<input type="date" name="endDate"/></label><label>Start time<input type="time" name="startTime" required/></label><label>End time<input type="time" name="endTime" required/></label><label>Room<input name="location"/></label></div><button disabled={pending} type="submit">Save meeting</button></form>:null}
      <ul className={styles.meetings}>{course.meetings.map(meeting=><li key={meeting.id}><div><strong>{meeting.title}</strong><span>{meeting.weekdays.map(day=>weekdays[day]).join(", ")} · {meeting.startTime}–{meeting.endTime}</span>{meeting.location?<span><MapPin size={12}/>{meeting.location}</span>:null}</div><button aria-label={`Delete ${meeting.title}`} type="button" onClick={()=>run(()=>deleteMeetingAction(meeting.id))}><Trash2 size={16}/></button></li>)}</ul>
      <button className={styles.archive} type="button" onClick={()=>run(()=>archiveCourseAction(course.id))}>Archive course</button>
    </Surface>)}</div>}
  </div>;
}

