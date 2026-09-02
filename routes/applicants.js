import { randomBytes } from "node:crypto";
import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import {
  EMAIL_PATTERN,
  APPLICANT_COLUMNS,
  toApplicantSummary,
  validateApplicantRow,
} from "../services/applicantShaping.js";
import { logApplicantEvent } from "../services/applicantEvents.js";
import applicantLifecycleRouter from "./applicantLifecycle.js";

const router = Router();

const KEY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

router.post("/applicants/generate-key", async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    res.status(400).json({ error: "name and email required" });
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: "invalid email" });
    return;
  }

  const { data: existing } = await supabase
    .from("applicants")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    res.status(409).json({ error: "email already registered" });
    return;
  }

  const apiKey = `sk_${randomBytes(24).toString("hex")}`;
  const expiresAt = new Date(Date.now() + KEY_EXPIRY_MS).toISOString();

  const { data, error } = await supabase
    .from("applicants")
    .insert({ name, email, api_key: apiKey, api_key_expires_at: expiresAt, status: "pending" })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: "Failed to save applicant" });
    return;
  }

  console.log(`[${new Date().toISOString()}] API key generated for ${email}`);

  res.status(201).json({
    applicant_id: data.id,
    api_key: data.api_key,
    expires_at: data.api_key_expires_at,
    status: data.status,
  });
});

router.post("/applicants/:id/expire-key", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("applicants")
    .update({ api_key_expires_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Applicant not found" });
    return;
  }

  res.json({ applicant_id: data.id, expires_at: data.api_key_expires_at });
});

router.get("/applicants", async (req, res) => {
  const { data, error } = await supabase
    .from("applicants")
    .select(`${APPLICANT_COLUMNS}, submission_results(*)`)
    .order("created_at", { ascending: false })
    .order("submitted_at", { foreignTable: "submission_results", ascending: false });

  if (error) {
    console.error("[GET /applicants] failed:", error.message);
    res.status(500).json({ error: "Failed to fetch applicants" });
    return;
  }

  res.json(data.map(toApplicantSummary));
});

router.post("/applicants", async (req, res) => {
  const { name, email, generatedBy } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: "valid email is required" });
    return;
  }

  const { data: existing } = await supabase
    .from("applicants")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    res.status(409).json({ error: "email already registered" });
    return;
  }

  const { data, error } = await supabase
    .from("applicants")
    .insert({ name: name.trim(), email, status: "pending_email" })
    .select(APPLICANT_COLUMNS)
    .single();

  if (error) {
    console.error("[POST /applicants] insert failed:", error.message);
    res.status(500).json({ error: "Failed to create applicant" });
    return;
  }

  await logApplicantEvent(data.id, "applicant_added", { createdBy: generatedBy ?? null });

  res.status(201).json(toApplicantSummary({ ...data, submission_results: [] }));
});

router.post("/applicants/bulk", async (req, res) => {
  const { applicants, generatedBy } = req.body;

  if (!Array.isArray(applicants) || applicants.length === 0) {
    res.status(400).json({ error: "applicants array is required" });
    return;
  }

  const { data: existingRows } = await supabase.from("applicants").select("email");
  const existingEmails = new Set((existingRows ?? []).map((r) => r.email.toLowerCase()));
  const seenInPayload = new Set();
  const errors = [];
  const toInsert = [];

  for (const row of applicants) {
    const { name, email, reason } = validateApplicantRow(row, existingEmails, seenInPayload);
    if (reason) {
      errors.push({ name, email, reason });
      continue;
    }
    seenInPayload.add(email.toLowerCase());
    toInsert.push({ name, email, status: "pending_email" });
  }

  if (toInsert.length === 0) {
    res.json({ inserted: [], errors });
    return;
  }

  const { data, error } = await supabase
    .from("applicants")
    .insert(toInsert)
    .select(APPLICANT_COLUMNS);

  if (error) {
    console.error("[POST /applicants/bulk] insert failed:", error.message);
    res.status(500).json({ error: "Failed to insert applicants" });
    return;
  }

  await Promise.all(
    data.map((row) =>
      logApplicantEvent(row.id, "applicant_added", { createdBy: generatedBy ?? null }),
    ),
  );

  res.json({
    inserted: data.map((row) => toApplicantSummary({ ...row, submission_results: [] })),
    errors,
  });
});

router.delete("/applicants/:id", async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("applicants").delete().eq("id", id);

  if (error) {
    console.error("[DELETE /applicants/:id] failed:", error.message);
    res.status(500).json({ error: "Failed to delete applicant" });
    return;
  }

  res.status(204).send();
});

// Per-applicant lifecycle actions (generate/revoke link, send email, event history) live in
// their own file — see routes/applicantLifecycle.js — purely to keep this file's line count
// down; mounting it here (not in server.js) keeps every /api/applicants path in one place.
router.use(applicantLifecycleRouter);

export default router;
