import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { hashPassword, toPublicUser, isValidPassword } from "../services/security.js";

const router = Router();

const ROLES = ["admin", "user"];

router.get("/", async (req, res) => {
  const { data, error } = await supabase.from("staff_users").select("*").order("username");

  if (error) {
    console.error("[GET /users] failed:", error.message);
    res.status(500).json({ error: "Failed to fetch users" });
    return;
  }

  res.json(data.map(toPublicUser));
});

router.post("/", async (req, res) => {
  const { username, role, temporaryPassword } = req.body;

  if (!username?.trim()) {
    res.status(400).json({ error: "Username is required" });
    return;
  }
  if (!ROLES.includes(role)) {
    res.status(400).json({ error: `Role must be one of: ${ROLES.join(", ")}` });
    return;
  }
  if (!isValidPassword(temporaryPassword)) {
    res.status(400).json({ error: "Temporary password must be at least 8 characters" });
    return;
  }

  const { data, error } = await supabase
    .from("staff_users")
    .insert({
      username: username.trim(),
      role,
      password_hash: hashPassword(temporaryPassword),
      must_change_password: true,
    })
    .select("*")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    const message = status === 409 ? "That username is already taken" : "Failed to create user";
    if (status === 500) console.error("[POST /users] failed:", error.message);
    res.status(status).json({ error: message });
    return;
  }

  res.status(201).json(toPublicUser(data));
});

router.put("/:id", async (req, res) => {
  const { username, role } = req.body;
  const update = {};

  if (username !== undefined) {
    if (!username.trim()) {
      res.status(400).json({ error: "Username cannot be empty" });
      return;
    }
    update.username = username.trim();
  }
  if (role !== undefined) {
    if (!ROLES.includes(role)) {
      res.status(400).json({ error: `Role must be one of: ${ROLES.join(", ")}` });
      return;
    }
    update.role = role;
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("staff_users")
    .update(update)
    .eq("id", req.params.id)
    .select("*")
    .single();

  if (error || !data) {
    const status = error?.code === "23505" ? 409 : error ? 500 : 404;
    const message =
      status === 409
        ? "That username is already taken"
        : status === 404
          ? "User not found"
          : "Failed to update user";
    if (status === 500) console.error("[PUT /users/:id] failed:", error.message);
    res.status(status).json({ error: message });
    return;
  }

  res.json(toPublicUser(data));
});

router.post("/:id/reset-password", async (req, res) => {
  const { temporaryPassword } = req.body;
  if (!isValidPassword(temporaryPassword)) {
    res.status(400).json({ error: "Temporary password must be at least 8 characters" });
    return;
  }

  const { data, error } = await supabase
    .from("staff_users")
    .update({
      password_hash: hashPassword(temporaryPassword),
      must_change_password: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .select("*")
    .single();

  if (error || !data) {
    console.error("[POST /users/:id/reset-password] failed:", error?.message);
    res
      .status(error ? 500 : 404)
      .json({ error: error ? "Failed to reset password" : "User not found" });
    return;
  }

  res.json(toPublicUser(data));
});

router.delete("/:id", async (req, res) => {
  const { data: target } = await supabase
    .from("staff_users")
    .select("role")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (target.role === "admin") {
    const { count } = await supabase
      .from("staff_users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if ((count ?? 0) <= 1) {
      res.status(400).json({ error: "Cannot delete the last remaining admin account" });
      return;
    }
  }

  const { error } = await supabase.from("staff_users").delete().eq("id", req.params.id);

  if (error) {
    console.error("[DELETE /users/:id] failed:", error.message);
    res.status(500).json({ error: "Failed to delete user" });
    return;
  }

  res.status(204).send();
});

export default router;
