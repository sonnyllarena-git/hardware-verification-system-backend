import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";
import { logApplicantEvent } from "../services/applicantEvents.js";

const router = Router();

// compliance_requirements has one row per (requirement, OS) — see db-schema.sql's applies_to
// column — so the caller filters `requirements` to the applicant's own OS family before this
// ever runs; this only needs to know how to check a single OS's rule.
function getOsFamily(osVersion) {
  return (osVersion ?? "").startsWith("macOS") ? "macos" : "windows";
}

function checkRequirement(requirement, specs) {
  const min = requirement.min_value;
  switch (requirement.requirement_type) {
    case "os":
      if (requirement.applies_to === "macos") {
        // min_value like "macOS 12", specs.osVersion like "macOS 14.6.2" (see the extension's
        // getOSLabel()) — compare major version only; fail closed if either isn't parseable.
        const minMajor = Number(min.match(/(\d+)/)?.[1] ?? "999");
        const applicantMajor = Number(specs.osVersion?.match(/macOS\s+(\d+)/)?.[1] ?? "-1");
        return applicantMajor >= minMajor;
      }
      // specs.osVersion is "Windows 10 (build N)" / "Windows 11 (build N)" from the extension's
      // getOSLabel(), not a bare "Windows 10" — match the prefix, not the whole string.
      return specs.osVersion?.startsWith("Windows 10") || specs.osVersion?.startsWith("Windows 11");
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
      // screenResolution can be a comma-separated "WIDTHxHEIGHT" list (one per connected
      // monitor, primary first — see the extension's renderDisplays()); only the primary
      // display's height matters for compliance, so take the first entry before splitting.
      const minHeight = Number(min.split("x")[1]);
      const height = Number((specs.screenResolution ?? "0x0").split(",")[0].split("x")[1]);
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
  const osFamily = getOsFamily(specs.osVersion);
  const applicableRequirements = requirements.filter((r) => r.applies_to === osFamily);
  const passFail = applicableRequirements.every((r) => checkRequirement(r, specs))
    ? "PASS"
    : "FAIL";

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
