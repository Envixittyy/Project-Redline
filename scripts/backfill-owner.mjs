import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerUserId = process.env.OWNER_USER_ID;
const finalize = process.argv.includes("--finalize");

const missing = [
  !url && "SUPABASE_URL",
  !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
  !ownerUserId && "OWNER_USER_ID",
].filter(Boolean);

if (missing.length > 0) {
  throw new Error(`Missing required environment variable(s): ${missing.join(", ")}.`);
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerUserId)) {
  throw new Error("OWNER_USER_ID must be a UUID from Supabase Auth.");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: ownerResult, error: ownerError } = await admin.auth.admin.getUserById(ownerUserId);
if (ownerError || !ownerResult.user) {
  throw new Error("OWNER_USER_ID does not identify a user in this Supabase project.");
}

const { data: backfillResult, error: backfillError } = await admin.rpc(
  "backfill_personal_data_owner",
  { target_owner: ownerUserId },
);
if (backfillError) throw new Error(`Owner backfill failed: ${backfillError.message}`);

const [tasksCheck, eventsCheck] = await Promise.all([
  admin.from("tasks").select("id", { count: "exact", head: true }).is("user_id", null),
  admin.from("calendar_events").select("id", { count: "exact", head: true }).is("user_id", null),
]);

if (tasksCheck.error) throw new Error(`Task verification failed: ${tasksCheck.error.message}`);
if (eventsCheck.error) throw new Error(`Calendar verification failed: ${eventsCheck.error.message}`);

const verification = {
  backfill: backfillResult,
  ownerless_tasks: tasksCheck.count,
  ownerless_calendar_events: eventsCheck.count,
};
console.log(JSON.stringify(verification, null, 2));

if (tasksCheck.count !== 0 || eventsCheck.count !== 0) {
  throw new Error("Ownerless rows remain; ownership was not finalized.");
}

if (finalize) {
  const { data, error } = await admin.rpc("finalize_personal_data_ownership");
  if (error) throw new Error(`Ownership finalization failed: ${error.message}`);
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log("Verification passed. Re-run with --finalize to enforce NOT NULL ownership.");
}
