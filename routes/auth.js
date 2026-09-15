import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";
import {
  SECURITY_QUESTIONS,
  hashPassword,
  comparePassword,
  hashAnswer,
  compareAnswer,
  toPublicUser,
  signSessionToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  isValidPassword,
} from "../services/security.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const { data: user } = await supabase
    .from("staff_users")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (!user || !comparePassword(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  res.json({ token: signSessionToken(user), user: toPublicUser(user) });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!isValidPassword(newPassword)) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const { data: user } = await supabase
    .from("staff_users")
    .select("*")
    .eq("id", req.user.sub)
    .maybeSingle();

  if (!user || !comparePassword(currentPassword, user.password_hash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const { data: updated, error } = await supabase
    .from("staff_users")
    .update({
      password_hash: hashPassword(newPassword),
      must_change_password: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("*")
    .single();

  if (error) {
    console.error("[POST /auth/change-password] failed:", error.message);
    res.status(500).json({ error: "Failed to change password" });
    return;
  }

  res.json({ token: signSessionToken(updated), user: toPublicUser(updated) });
});

router.post("/security-questions", requireAuth, async (req, res) => {
  const { question1, answer1, question2, answer2 } = req.body;

  if (!SECURITY_QUESTIONS.includes(question1) || !SECURITY_QUESTIONS.includes(question2)) {
    res.status(400).json({ error: "Questions must be chosen from the preset list" });
    return;
  }
  if (question1 === question2) {
    res.status(400).json({ error: "Please choose two different questions" });
    return;
  }
  if (!answer1?.trim() || !answer2?.trim()) {
    res.status(400).json({ error: "Both answers are required" });
    return;
  }

  const { data: updated, error } = await supabase
    .from("staff_users")
    .update({
      security_question_1: question1,
      security_answer_1_hash: hashAnswer(answer1),
      security_question_2: question2,
      security_answer_2_hash: hashAnswer(answer2),
      security_questions_set: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.user.sub)
    .select("*")
    .single();

  if (error) {
    console.error("[POST /auth/security-questions] failed:", error.message);
    res.status(500).json({ error: "Failed to save security questions" });
    return;
  }

  res.json({ token: signSessionToken(updated), user: toPublicUser(updated) });
});

router.get("/security-questions/:username", async (req, res) => {
  const { data: user } = await supabase
    .from("staff_users")
    .select("security_question_1, security_question_2, security_questions_set")
    .eq("username", req.params.username)
    .maybeSingle();

  if (!user || !user.security_questions_set) {
    res.status(404).json({
      error: "No account found with security questions set up. Contact an administrator.",
    });
    return;
  }

  res.json({ question1: user.security_question_1, question2: user.security_question_2 });
});

router.post("/verify-security-answers", async (req, res) => {
  const { username, answer1, answer2 } = req.body;

  const { data: user } = await supabase
    .from("staff_users")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  const valid =
    user?.security_questions_set &&
    compareAnswer(answer1, user.security_answer_1_hash) &&
    compareAnswer(answer2, user.security_answer_2_hash);

  if (!valid) {
    res.status(401).json({ error: "One or more answers are incorrect" });
    return;
  }

  res.json({ resetToken: signPasswordResetToken(user.id) });
});

router.post("/reset-password", async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!isValidPassword(newPassword)) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  let payload;
  try {
    payload = verifyPasswordResetToken(resetToken);
  } catch {
    res.status(401).json({ error: "Reset link is invalid or has expired" });
    return;
  }

  const { error } = await supabase
    .from("staff_users")
    .update({
      password_hash: hashPassword(newPassword),
      must_change_password: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.sub);

  if (error) {
    console.error("[POST /auth/reset-password] failed:", error.message);
    res.status(500).json({ error: "Failed to reset password" });
    return;
  }

  res.status(204).send();
});

export default router;
