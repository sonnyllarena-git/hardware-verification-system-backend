// Shared applicant read/write shaping — kept out of routes/applicants.js so that file stays
// closer to the project's ~250-line budget with 10 endpoints living in it.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const APPLICANT_COLUMNS =
  "id, name, email, status, api_key, api_key_expires_at, api_key_revoked, generated_by, generated_at, email_sent_at, email_resend_count";

// Mirrors routes/results.js's toResult() specs-shaping exactly, so the dashboard's specs display
// works the same whether it reads a result via /api/results or embedded in /api/applicants.
export function toApplicantSummary(applicant) {
  const latest = applicant.submission_results?.[0] ?? null;

  return {
    id: applicant.id,
    name: applicant.name,
    email: applicant.email,
    status: applicant.status,
    apiKey: applicant.api_key,
    apiKeyExpiresAt: applicant.api_key_expires_at,
    apiKeyRevoked: applicant.api_key_revoked,
    generatedBy: applicant.generated_by,
    generatedAt: applicant.generated_at,
    emailSentAt: applicant.email_sent_at,
    emailResendCount: applicant.email_resend_count,
    result: latest
      ? {
          passFail: latest.pass_fail,
          submittedAt: latest.submitted_at,
          specs: {
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
          },
        }
      : null,
  };
}

// One validation pass for a bulk-upload row: catches a blank name, a malformed email, and both
// duplicate flavors (already in the DB, or repeated earlier in this same payload) in one place
// so routes/applicants.js's bulk handler stays a plain loop.
export function validateApplicantRow(row, existingEmails, seenInPayload) {
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  const email = typeof row?.email === "string" ? row.email.trim() : "";
  const emailLower = email.toLowerCase();

  let reason = null;
  if (!name) reason = "name is required";
  else if (!EMAIL_PATTERN.test(email)) reason = "invalid email";
  else if (existingEmails.has(emailLower)) reason = "email already registered";
  else if (seenInPayload.has(emailLower)) reason = "duplicate email in upload";

  return { name, email, reason };
}
