"use server";
import { revalidatePath } from "next/cache";
import {
  preparePredictionConversion,
  revisePredictionConversion,
  applyPredictionTask,
  applyPredictionEvent,
  type ConversionKind,
} from "@/services/integrations/ai/prediction-conversion-repository";
export async function preparePredictionConversionAction(
  id: string,
  kind: ConversionKind,
) {
  return preparePredictionConversion(id, kind);
}
export async function revisePredictionConversionAction(
  id: string,
  kind: ConversionKind,
  item: unknown,
) {
  return revisePredictionConversion(id, kind, item);
}
export async function applyPredictionTaskAction(id: string) {
  const r = await applyPredictionTask(id);
  for (const p of ["/school", "/tasks", "/calendar", "/"]) revalidatePath(p);
  return r;
}
export async function applyPredictionEventAction(id: string) {
  const r = await applyPredictionEvent(id);
  for (const p of ["/school", "/calendar", "/"]) revalidatePath(p);
  return r;
}
