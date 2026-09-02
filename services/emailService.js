import { Resend } from "resend";

// Real sender (TASK BB8, 2026-09-02) — swapped in from the TASK BB2 stub now that Sonny supplied
// a Resend API key. Same {to, subject, body} in / {sent, error?} out shape the stub always
// returned, so routes/applicantLifecycle.js's send-email handler didn't need to change — only
// now checks `result.sent` (see that file), since this real call can genuinely fail where the
// stub never could.
const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendApplicantEmail({ to, subject, body }) {
  if (!process.env.RESEND_API_KEY) {
    console.error("[emailService] RESEND_API_KEY not set — email not sent");
    return { sent: false, error: "Email service not configured" };
  }

  // RESEND_FROM_EMAIL must be a sender Resend has verified for this account (their own
  // onboarding@resend.dev test address always works) — anything else fails with a 502
  // "The domain is invalid" from Resend, not from this service.
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject,
    text: body,
  });

  if (error) {
    console.error(`[emailService] Resend error sending to ${to}:`, error.message);
    return { sent: false, error: error.message };
  }

  console.log(`[emailService] sent to=${to} messageId=${data.id}`);
  return { sent: true, messageId: data.id };
}
