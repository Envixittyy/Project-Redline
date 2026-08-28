"use server";

import { revalidatePath } from "next/cache";

import { archiveNote, createNote, updateNote } from "@/services/notes/note-repository";
import { authFailureMessage } from "@/services/supabase/errors";

export type NoteActionResult = {ok:true;id?:string}|{ok:false;message:string};
class InvalidNoteInput extends Error {}
function value(input:unknown,label:string,max:number){if(typeof input!=="string")throw new InvalidNoteInput(`${label} is required.`);const next=input.trim();if(!next)throw new InvalidNoteInput(`${label} is required.`);if(next.length>max)throw new InvalidNoteInput(`${label} is too long.`);return next;}
const optionalId=(input:unknown)=>typeof input==="string"&&input.trim()?input.trim():null;
function result(error:unknown):NoteActionResult{if(error instanceof InvalidNoteInput)return{ok:false,message:error.message};const auth=authFailureMessage(error);if(auth)return{ok:false,message:auth};console.error("[notes] action failed:",error);return{ok:false,message:error instanceof Error?error.message:"The note could not be saved."};}
function refresh(){revalidatePath("/notes");revalidatePath("/");revalidatePath("/tasks");revalidatePath("/school");}
export type NoteInput={title:string;body:string;taskId?:string|null;courseId?:string|null;operationId?:string|null};
export async function saveNoteAction(id:unknown,input:NoteInput):Promise<NoteActionResult>{
 try{const draft={title:value(input?.title,"A title",200),body:typeof input?.body==="string"?input.body:"",taskId:optionalId(input?.taskId),courseId:optionalId(input?.courseId)};const note=typeof id==="string"&&id?await updateNote(id,draft):await createNote({...draft,operationId:optionalId(input?.operationId)});refresh();return{ok:true,id:note.id};}catch(error){return result(error);}
}
export async function archiveNoteAction(id:unknown):Promise<NoteActionResult>{try{await archiveNote(value(id,"The note ID",100));refresh();return{ok:true};}catch(error){return result(error);}}

