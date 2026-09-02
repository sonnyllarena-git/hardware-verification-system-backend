import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { logApplicantEvent } from "../services/applicantEvents.js";

const router = Router();

function checkRequirement(requirement, specs) {
  const min = requirement.min_value;
  switch (requirement.requirement_type) {
    case "os":
      return specs.osVersion === "Windows 10" || specs.osVersion === "Windows 11";
    case "cpu":
      return specs.cpuCores >= Number(min);
    case "ram":
      return specs.ramGb >= Number(min);
    case "storage":
      return specs.storageGb >= Number(min);
    case "internet":
      return requirement.requirement_name.includes("Down")
        ? specs.internetSpeedDown >= Number(min)
        : specs.internetSpeedUp >= Number(min);
    case "screen": {
      const minHeight = Number(min.split("x")[1]);
      const height = Number((specs.screenResolution ?? "0x0").split("x")[1]);
      return height >= minHeight;
    }
    case "hardware":
      return requirement.requirement_name === "Webcam"
        ? specs.webcamPresent === true
        : specs.headsetPresent === true;
    default:
      return true;
  }
}

const REQUIRED_FIELDS = ["osVersion", "cpuCores", "ramGb", "storageGb"];

router.post("/", async (req, res) => {
  const apiKey = req.header("X-API-Key");
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const specs = req.body;
  if (REQUIRED_FIELDS.some((field) => specs[field] === undefined)) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const { data: applicant } = await supabase
    .from("applicants")
    .select("id, api_key_expires_at")
    .eq("api_key", apiKey)
    .single();

  if (!applicant) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  if (applicant.api_key_expires_at && new Date(applicant.api_key_expires_at) < new Date()) {
    res.status(401).json({ error: "API key expired" });
    return;
  }

  const { data: requirements } = await supabase.from("compliance_requirements").select("*");
  const passFail = requirements.every((r) => checkRequirement(r, specs)) ? "PASS" : "FAIL";

  const { error: insertError } = await supabase.from("submission_results").insert({
    applicant_id: applicant.id,
    os_version: specs.osVersion,
    cpu_cores: specs.cpuCores,
    cpu_brand: specs.cpuBrand,
    cpu_model: specs.cpuModel,
    ram_gb: specs.ramGb,
    storage_gb: specs.storageGb,
    storage_type: specs.storageType,
    screen_resolution: specs.screenResolution,
    internet_speed_down: specs.internetSpeedDown,
    internet_speed_up: specs.internetSpeedUp,
    webcam_present: specs.webcamPresent,
    headset_present: specs.headsetPresent,
    pass_fail: passFail,
    storage_drives: specs.storageDrives ?? null,
  });

  if (insertError) {
    res.status(500).json({ error: "Failed to save submission" });
    return;
  }

  await supabase
    .from("applicants")
    .update({ status: passFail.toLowerCase() })
    .eq("id", applicant.id);

  await logApplicantEvent(applicant.id, "result_submitted", { details: { result: passFail } });

  res.status(201).json({ status: passFail });
});

export default router;
