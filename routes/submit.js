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

// Major version numbers for the only 3 macOS releases HR currently allows: Sonoma (14),
// Sequoia (15), Tahoe (26 — Apple switched to year-based numbering in 2025, so this isn't 16).
const APPROVED_MACOS_MAJORS = [14, 15, 26];

// Any Mac (Apple Silicon or Intel) is approved purely by being on one of those 3 OS versions —
// chip family doesn't matter for Mac. Windows instead gates on CPU family: Intel Core i5/i7/i9
// or AMD Ryzen 3/5/7/9. Core count isn't part of this gate either way. Duplicated (by hand) in
// direct-submit-rpc.sql and the dashboard's resultsService.js — see those files' own copies.
function isApprovedCpu(specs) {
  if ((specs.osVersion ?? "").startsWith("macOS")) {
    const macMajor = Number(specs.osVersion?.match(/macOS\s+(\d+)/)?.[1] ?? "-1");
    return APPROVED_MACOS_MAJORS.includes(macMajor);
  }

  const model = (specs.cpuModel ?? "").toLowerCase();
  return /\bi[579]\b/.test(model) || /ryzen\s*[3579]\b/.test(model);
}

function checkRequirement(requirement, specs) {
  const min = requirement.min_value;
  switch (requirement.requirement_type) {
    case "os": {
      // min_value is like "macOS 12" / "Windows 11"; specs.osVersion is like "macOS 14.6.2" or
      // "Windows 10 (build N)" (see the extension's getOSLabel()) — compare major version
      // numerically, fail closed if either isn't parseable. This used to special-case Windows
      // as "is it 10 or 11 at all", which ignored min_value entirely — a "Windows 11" minimum
      // let a Windows 10 machine through, since 10 or 11 both satisfied that check.
      const osLabel = requirement.applies_to === "macos" ? "macOS" : "Windows";
      const minMajor = Number(min.match(/(\d+)/)?.[1] ?? "999");
      const applicantMajor = Number(
        specs.osVersion?.match(new RegExp(`${osLabel}\\s+(\\d+)`))?.[1] ?? "-1",
      );
      return applicantMajor >= minMajor;
    }
    case "cpu":
      return isApprovedCpu(specs);
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
    .select("id, api_key_expires_at, api_key_revoked")
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
  // Revoke Link (dashboard) only ever set this column — it was never actually checked here, so
  // a revoked link kept working until it naturally expired. Same gap existed in the Supabase RPC
  // lane (direct-submit-rpc.sql), fixed alongside this.
  if (applicant.api_key_revoked) {
    res.status(401).json({ error: "API key revoked" });
    return;
  }

  const { data: requirements } = await supabase.from("compliance_requirements").select("*");
  const osFamily = getOsFamily(specs.osVersion);
  // `required` was previously ignored here too — a requirement toggled "Required: No" in
  // Settings still failed every applicant who didn't meet it.
  const applicableRequirements = requirements.filter(
    (r) => r.applies_to === osFamily && r.required,
  );
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
