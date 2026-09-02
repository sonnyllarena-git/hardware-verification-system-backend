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
          ram: latest.ram_gb,
          storageGb: latest.storage_gb,
          internetDown: latest.internet_speed_down,
          internetUp: latest.internet_speed_up,
          screenResolution: latest.screen_resolution,
          screenHeight: Number(latest.screen_resolution?.split("x")[1]) || null,
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
    .order("created_at", { ascending: false });

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
