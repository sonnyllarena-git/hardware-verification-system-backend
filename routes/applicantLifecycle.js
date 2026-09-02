import { randomBytes } from "node:crypto";
import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { logApplicantEvent } from "../services/applicantEvents.js";
import { sendApplicantEmail } from "../services/emailService.js";

// Mounted into routes/applicants.js (not server.js — see that file's own comment) purely to keep
// applicants.js under the project's ~250-line budget; these four routes are still logically part
// of the same /api/applicants resource, just the per-applicant lifecycle actions.
const router = Router();

const KEY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

router.post("/applicants/:id/generate-link", async (req, res) => {
  const { id } = req.params;
  const { generatedBy } = req.body;

  const apiKey = `sk_${randomBytes(24).toString("hex")}`;
  const expiresAt = new Date(Date.now() + KEY_EXPIRY_MS).toISOString();

  const { data, error } = await supabase
    .from("applicants")
    .update({
      api_key: apiKey,
      api_key_expires_at: expiresAt,
      api_key_revoked: false,
      generated_by: generatedBy ?? null,
      generated_at: new Date().toISOString(),
      status: "pending",
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Applicant not found" });
    return;
  }

  await logApplicantEvent(data.id, "link_generated", {
    details: { expiresAt },
    createdBy: generatedBy ?? null,
  });

  res.json({ applicantId: data.id, apiKey, expiresAt });
});

router.post("/applicants/:id/revoke-link", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("applicants")
    .update({ api_key_revoked: true, status: "pending_email" })
    .eq("id", id)
    .select("id, api_key_revoked, status")
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Applicant not found" });
    return;
  }

  await logApplicantEvent(data.id, "link_revoked", {});

  res.json({ applicantId: data.id, apiKeyRevoked: data.api_key_revoked, status: data.status });
});

router.post("/applicants/:id/send-email", async (req, res) => {
  const { id } = req.params;
  const { subject, body } = req.body;

  if (!subject || !body) {
    res.status(400).json({ error: "subject and body are required" });
    return;
  }

  const { data: applicant, error: fetchError } = await supabase
    .from("applicants")
    .select("id, email, email_sent_at, email_resend_count")
    .eq("id", id)
    .single();

  if (fetchError || !applicant) {
    res.status(404).json({ error: "Applicant not found" });
    return;
  }

  const sendResult = await sendApplicantEmail({ to: applicant.email, subject, body });
  if (!sendResult.sent) {
    // The stub this replaced (TASK BB2) always resolved {sent:true}, so nothing downstream ever
    // needed to branch on failure. A real provider can genuinely fail (bad recipient, rate limit,
    // provider outage) — stop here so a failed send never gets logged as sent.
    res.status(502).json({ error: sendResult.error || "Failed to send email" });
    return;
  }

  // "Already set" is judged from the value fetched before this send, so the very first send of
  // this call never mistakes itself for a resend.
  const isResend = Boolean(applicant.email_sent_at);
  const update = isResend
    ? { email_resend_count: (applicant.email_resend_count ?? 0) + 1 }
    : { email_sent_at: new Date().toISOString() };

  const { error: updateError } = await supabase.from("applicants").update(update).eq("id", id);

  if (updateError) {
    console.error("[POST /applicants/:id/send-email] update failed:", updateError.message);
    res.status(500).json({ error: "Failed to record email send" });
    return;
  }

  await logApplicantEvent(id, isResend ? "email_resent" : "email_sent", {});

  res.json({ sent: true });
});

router.get("/applicants/:id/events", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("applicant_events")
    .select("event_type, details, created_by, created_at")
    .eq("applicant_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /applicants/:id/events] failed:", error.message);
    res.status(500).json({ error: "Failed to fetch applicant events" });
    return;
  }

  res.json(
    data.map((row) => ({
      eventType: row.event_type,
      details: row.details,
      createdBy: row.created_by,
      createdAt: row.created_at,
    })),
  );
});

export default router;
