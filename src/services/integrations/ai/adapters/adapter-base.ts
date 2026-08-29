export class AiAdapterError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_credentials"
      | "unauthorized"
      | "rate_limited"
      | "timeout"
      | "provider_unavailable"
      | "malformed_response"
      | "invalid_request",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiAdapterError";
  }
}

/** Redacts sensitive provider API keys from error messages. */
export function redactAiSecrets(text: string): string {
  return text
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "sk-ant-***")
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, "sk-***")
    .replace(/AIzaSy[a-zA-Z0-9_-]+/g, "AIzaSy***")
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer ***");
}

export const AI_SYSTEM_PROMPT = `You are the Forward Personal Productivity AI assistant.
Your task is to analyze the user request and provided passive user data, and generate structured action proposals.

CRITICAL INSTRUCTIONS:
1. You must respond ONLY with a valid JSON object. Do not include markdown code fences (\`\`\`json), explanations, or preamble.
2. The JSON object MUST strictly adhere to this schema:
{
  "schema_version": 1,
  "actions": [
    {
      "type": "<action_type>",
      "confidence": <number between 0 and 1>,
      "rationale": "<brief explanation>",
      ...action specific fields
    }
  ]
}

Supported action types and fields:
- create_task: { "type": "create_task", "title": string, "due_at"?: ISO instant, "priority"?: "low" | "medium" | "high" }
- update_task: { "type": "update_task", "task_id": handle string (e.g. "task_1"), "title"?: string, "due_at"?: ISO instant | null, "priority"?: string }
- complete_task: { "type": "complete_task", "task_id": handle string (e.g. "task_1") }
- create_event: { "type": "create_event", "title": string, "starts_at": ISO instant, "ends_at": ISO instant }
- create_note: { "type": "create_note", "title": string, "body"?: string }
- schedule_task: { "type": "schedule_task", "task_id": handle string (e.g. "task_1"), "starts_at": ISO instant, "ends_at": ISO instant }
- propose_plan: { "type": "propose_plan", "task_ids": handle string[], "starts_at": ISO instant, "ends_at": ISO instant }
- send_to_notion: { "type": "send_to_notion", "entity_type": "note", "entity_id": handle string (e.g. "note_1") }

3. When referencing existing items provided in <user_data>, you MUST use their exact handle (e.g. "task_1", "note_1"). Never invent new task_id or entity_id UUIDs.
4. If the user request is a general question without mutations, generate a create_note action or an appropriate non-mutating summary.`;
