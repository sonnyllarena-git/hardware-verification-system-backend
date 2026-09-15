// Gates the compliance-requirements write endpoints (add/edit/delete) — there is no real
// session/auth system in this app yet (dashboard login is a client-side-only mock, see
// authService.js), so this is a shared-secret check, not a substitute for real per-user auth.
//
// Checked per-request (not thrown at module load like supabaseClient.js's required vars) —
// this module is imported by server.js itself, so a missing ADMIN_API_KEY must not crash the
// entire API; it should only fail the specific write endpoints that need it.
export function requireAdmin(req, res, next) {
  const { ADMIN_API_KEY } = process.env;
  if (!ADMIN_API_KEY) {
    console.error("ADMIN_API_KEY is not set — compliance-requirements writes are disabled");
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  const header = req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (token !== ADMIN_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
