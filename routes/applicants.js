import { randomBytes } from "node:crypto";
import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

export default router;
