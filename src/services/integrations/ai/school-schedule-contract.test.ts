import { describe, expect, it } from "vitest";
import { parseScheduleExtraction, SCHEDULE_IMAGE_CAPABILITY } from "./school-schedule-contract";
const handle="schedule_handle_123";
const valid={schema_version:1,type:"extract_schedule",source_handle:handle,courses:[{code:"CS101",name:"Computer Science",meetings:[{weekday:"monday",startTime:"09:00",endTime:"10:30",room:"Science 204"}]}]};
describe("schedule screenshot extraction",()=>{
  it("accepts exact visible facts and permits an absent unknown end time",()=>{const parsed=parseScheduleExtraction(JSON.stringify({...valid,courses:[{...valid.courses[0],meetings:[{weekday:"monday",startTime:"09:00"}]}]}),SCHEDULE_IMAGE_CAPABILITY.id,handle);expect(parsed.courses[0].meetings[0].endTime).toBeUndefined()});
  it.each(["funday","Monday",""])("rejects weekday %s",weekday=>expect(()=>parseScheduleExtraction(JSON.stringify({...valid,courses:[{...valid.courses[0],meetings:[{weekday,startTime:"09:00",endTime:"10:00"}]}]}),SCHEDULE_IMAGE_CAPABILITY.id,handle)).toThrow("invalid_output"));
  it.each(["9:00","24:00","09:60"])("rejects malformed time %s",startTime=>expect(()=>parseScheduleExtraction(JSON.stringify({...valid,courses:[{...valid.courses[0],meetings:[{weekday:"monday",startTime,endTime:"10:00"}]}]}),SCHEDULE_IMAGE_CAPABILITY.id,handle)).toThrow("invalid_output"));
  it("rejects authority and unknown fields",()=>expect(()=>parseScheduleExtraction(JSON.stringify({...valid,courses:[{...valid.courses[0],targetCourseId:"00000000-0000-0000-0000-000000000000"}]}),SCHEDULE_IMAGE_CAPABILITY.id,handle)).toThrow("invalid_output"));
});
