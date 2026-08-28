import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";

export const runtime = "nodejs";
const BUCKET="private-attachments";const MAX_SIZE=10*1024*1024;
const allowedType=/^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/(plain|markdown)|application\/(vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)))$/;
function sameOrigin(request:Request){const origin=request.headers.get("origin");return !origin||origin===new URL(request.url).origin;}
function cleanName(value:string){return value.normalize("NFKC").replace(/[\\/\0-\x1f\x7f]/g,"-").trim().slice(0,180)||"attachment";}
function safeFailure(error:unknown){console.error("[attachments] request failed:",error);return NextResponse.json({message:"The attachment request could not be completed."},{status:500});}

type AttachmentListRow={id:string;note_id:string|null;task_id:string|null;file_name:string;content_type:string;size_bytes:number;created_at:string};
export async function GET(request:Request){
 try{const noteId=new URL(request.url).searchParams.get("noteId");if(!noteId)return NextResponse.json({message:"A note is required."},{status:400});const{client,userId}=await requireAuthenticatedSupabase();const{data,error}=await client.from("attachments").select("id,note_id,task_id,file_name,content_type,size_bytes,created_at").eq("user_id",userId).eq("note_id",noteId).order("created_at");if(error)throw error;return NextResponse.json(((data??[]) as AttachmentListRow[]).map(row=>({id:row.id,noteId:row.note_id,taskId:row.task_id,fileName:row.file_name,contentType:row.content_type,sizeBytes:row.size_bytes,createdAt:row.created_at})),{headers:{"Cache-Control":"no-store"}});}catch(error){return safeFailure(error);}
}

export async function POST(request:Request){
 if(!sameOrigin(request))return NextResponse.json({message:"Invalid request origin."},{status:403});
 try{const form=await request.formData();const noteId=form.get("noteId");const file=form.get("file");if(typeof noteId!=="string"||!noteId||!(file instanceof File))return NextResponse.json({message:"Choose a note and file."},{status:400});if(file.size<1||file.size>MAX_SIZE)return NextResponse.json({message:"Attachments must be between 1 byte and 10 MB."},{status:400});if(!allowedType.test(file.type))return NextResponse.json({message:"That file type is not supported."},{status:400});const{client,userId}=await requireAuthenticatedSupabase();const note=await client.from("notes").select("id").eq("id",noteId).eq("user_id",userId).maybeSingle();if(note.error)throw note.error;if(!note.data)return NextResponse.json({message:"That note no longer exists."},{status:404});const fileName=cleanName(file.name);const storagePath=`${userId}/${randomUUID()}/${fileName}`;const upload=await client.storage.from(BUCKET).upload(storagePath,await file.arrayBuffer(),{contentType:file.type,upsert:false});if(upload.error)throw upload.error;const inserted=await client.from("attachments").insert({user_id:userId,note_id:noteId,file_name:fileName,storage_path:storagePath,content_type:file.type,size_bytes:file.size}).select("id").single();if(inserted.error){await client.storage.from(BUCKET).remove([storagePath]);throw inserted.error;}return NextResponse.json({id:inserted.data.id},{status:201});}catch(error){return safeFailure(error);}
}
