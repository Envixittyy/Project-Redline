"use server";
import { revalidatePath } from "next/cache";
import { configureBlackboardFeed,runBlackboardSync } from "@/services/integrations/blackboard/blackboard-repository";
import { validateFeedUrl } from "@/services/integrations/blackboard/safe-url";
export type IntegrationActionResult={ok:true;message:string}|{ok:false;message:string};
function refresh(){revalidatePath("/integrations/blackboard");revalidatePath("/tasks");revalidatePath("/");}
export async function configureBlackboardAction(feedUrl:unknown):Promise<IntegrationActionResult>{try{if(typeof feedUrl!=="string")throw new Error("Enter your private Blackboard calendar URL.");const url=validateFeedUrl(feedUrl);await configureBlackboardFeed(url.toString());refresh();return{ok:true,message:"Blackboard calendar connected. The credential is encrypted and will not be shown again."};}catch(error){console.error("[blackboard] configuration failed:",error);return{ok:false,message:error instanceof Error?error.message:"Blackboard could not be connected."};}}
export async function syncBlackboardAction():Promise<IntegrationActionResult>{try{const result=await runBlackboardSync();refresh();return{ok:true,message:`Sync complete: ${result.created} new, ${result.updated} updated, ${result.missing} missing-source.`};}catch(error){console.error("[blackboard] sync failed:",error);return{ok:false,message:"Blackboard sync failed safely. Review Sync health and try again."};}}
