import { describe, expect, it } from "vitest";
import { BLACKBOARD_COURSE_IMAGE_CAPABILITY, parseBlackboardExtraction } from "./blackboard-screenshot-contract";
const handle="bb_handle_123";
describe("Blackboard screenshot extraction",()=>{
  it("accepts a visible label without inventing code or title",()=>{const result=parseBlackboardExtraction(JSON.stringify({schema_version:1,type:"extract_blackboard_courses",source_handle:handle,courses:[{sourceLabel:"Visible Blackboard label"}]}),BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,handle);expect(result.courses).toEqual([{sourceLabel:"Visible Blackboard label"}])});
  it.each(["blackboardId","externalId","mappingId","providerId"])("rejects authority-like field %s",field=>expect(()=>parseBlackboardExtraction(JSON.stringify({schema_version:1,type:"extract_blackboard_courses",source_handle:handle,courses:[{sourceLabel:"Course",[field]:"fake"}]}),BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,handle)).toThrow("invalid_output"));
  it("rejects URLs",()=>expect(()=>parseBlackboardExtraction(JSON.stringify({schema_version:1,type:"extract_blackboard_courses",source_handle:handle,courses:[{sourceLabel:"https://example.com/course"}]}),BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,handle)).toThrow("invalid_output"));
});
