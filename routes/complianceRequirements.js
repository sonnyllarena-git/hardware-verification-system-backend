import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

const TYPE_OPTIONS = ["os", "cpu", "ram", "storage", "internet", "screen", "hardware"];
const APPLIES_TO_OPTIONS = ["windows", "macos"];

const COLUMNS =
  "id, requirement_name, requirement_type, applies_to, min_value, max_value, required, description";

// Matches the Settings page's exact field names (requirementsService.js/RequirementModal.jsx),
// unchanged from when they were mock-only — so no frontend component needed to change shape.
function toRequirement(row) {
  return {
    id: row.id,
    name: row.requirement_name,
    type: row.requirement_type,
    appliesTo: row.applies_to,
    minValue: row.min_value ?? "",
    maxValue: row.max_value ?? "",
    required: row.required,
    description: row.description ?? "",
  };
}

function validateRequirementBody(body) {
  const { name, type, appliesTo, minValue } = body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return "name is required";
  }
  if (!TYPE_OPTIONS.includes(type)) {
    return `type must be one of: ${TYPE_OPTIONS.join(", ")}`;
  }
  if (!APPLIES_TO_OPTIONS.includes(appliesTo)) {
    return `appliesTo must be one of: ${APPLIES_TO_OPTIONS.join(", ")}`;
  }
  if (!minValue || typeof minValue !== "string" || !minValue.trim()) {
    return "minValue is required";
  }
  return null;
}

function toRow(body) {
  return {
    requirement_name: body.name.trim(),
    requirement_type: body.type,
    applies_to: body.appliesTo,
    min_value: body.minValue.trim(),
    max_value: body.maxValue?.trim() || null,
    required: Boolean(body.required),
    description: body.description?.trim() || null,
  };
}

router.get("/compliance-requirements", async (req, res) => {
  const { data, error } = await supabase
    .from("compliance_requirements")
    .select(COLUMNS)
    .order("requirement_name")
    .order("applies_to");

  if (error) {
    console.error("[GET /compliance-requirements] failed:", error.message);
    res.status(500).json({ error: "Failed to fetch compliance requirements" });
    return;
  }

  res.json(data.map(toRequirement));
});

router.post("/compliance-requirements", requireAdmin, async (req, res) => {
  const validationError = validateRequirementBody(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { data, error } = await supabase
    .from("compliance_requirements")
    .insert(toRow(req.body))
    .select(COLUMNS)
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    const message =
      status === 409
        ? "A requirement with this name already exists for this OS"
        : "Failed to create requirement";
    console.error("[POST /compliance-requirements] failed:", error.message);
    res.status(status).json({ error: message });
    return;
  }

  res.status(201).json(toRequirement(data));
});

router.put("/compliance-requirements/:id", requireAdmin, async (req, res) => {
  const validationError = validateRequirementBody(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { data, error } = await supabase
    .from("compliance_requirements")
    .update(toRow(req.body))
    .eq("id", req.params.id)
    .select(COLUMNS)
    .single();

  if (error || !data) {
    const status = error?.code === "23505" ? 409 : error ? 500 : 404;
    const message =
      status === 409
        ? "A requirement with this name already exists for this OS"
        : status === 404
          ? "Requirement not found"
          : "Failed to update requirement";
    if (status === 500) console.error("[PUT /compliance-requirements/:id] failed:", error.message);
    res.status(status).json({ error: message });
    return;
  }

  res.json(toRequirement(data));
});

router.delete("/compliance-requirements/:id", requireAdmin, async (req, res) => {
  const { error } = await supabase.from("compliance_requirements").delete().eq("id", req.params.id);

  if (error) {
    console.error("[DELETE /compliance-requirements/:id] failed:", error.message);
    res.status(500).json({ error: "Failed to delete requirement" });
    return;
  }

  res.status(204).send();
});

export default router;
