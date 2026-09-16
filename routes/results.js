import { Router } from "express";
import { supabase } from "../services/supabaseClient.js";

const router = Router();

function toResult(applicant) {
  const latest = applicant.submission_results?.[0] ?? null;

  return {
    id: applicant.id,
    name: applicant.name,
    email: applicant.email,
    status: latest ? latest.pass_fail : "PENDING",
    submittedDate: latest?.submitted_at ?? null,
    osFamily: latest?.os_version?.startsWith("macOS") ? "macos" : latest ? "windows" : null,
    specs: latest
      ? {
          osVersion: latest.os_version,
          cpuCores: latest.cpu_cores,
          cpuModel: latest.cpu_model,
          ram: latest.ram_gb,
          storageGb: latest.storage_gb,
          storageDrives: latest.storage_drives,
          internetDown: latest.internet_speed_down,
          internetUp: latest.internet_speed_up,
          screenResolution: latest.screen_resolution,
          // screen_resolution can be a comma-separated "WIDTHxHEIGHT" list (one per connected
          // monitor, primary first — see the extension's renderDisplays()); only the primary
          // display's height matters for compliance, so take the first entry before splitting.
          screenHeight: Number(latest.screen_resolution?.split(",")[0]?.split("x")[1]) || null,
          webcam: latest.webcam_present,
          headset: latest.headset_present,
        }
      : null,
  };
}

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("applicants")
    .select("id, name, email, submission_results(*)")
    .order("created_at", { ascending: false })
    .order("submitted_at", { foreignTable: "submission_results", ascending: false });

  if (error) {
    res.status(500).json({ error: "Failed to fetch results" });
    return;
  }

  res.json(data.map(toResult));
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("applicants").delete().eq("id", id);

  if (error) {
    res.status(500).json({ error: "Failed to delete result" });
    return;
  }

  res.status(204).send();
});

export default router;
