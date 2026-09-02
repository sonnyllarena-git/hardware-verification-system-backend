import { supabase } from "./supabaseClient.js";

// Central audit-trail insert — every lifecycle action (add/generate/revoke/email) logs one row
// here so the several call sites in routes/applicants.js can't drift into different insert shapes.
// A logging failure is swallowed (server-logged only): losing an audit row must never fail the
// user-facing action that triggered it.
export async function logApplicantEvent(
  applicantId,
  eventType,
  { details = null, createdBy = null } = {},
) {
  const { error } = await supabase.from("applicant_events").insert({
    applicant_id: applicantId,
    event_type: eventType,
    details,
    created_by: createdBy,
  });

  if (error) {
    console.error(
      `[applicant_events] failed to log "${eventType}" for ${applicantId}:`,
      error.message,
    );
  }
}
