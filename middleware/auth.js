import jwt from "jsonwebtoken";

// Replaces the old shared-secret ADMIN_API_KEY check (adminAuth.js) now that real per-user
// accounts exist (see routes/auth.js, the `staff_users` table). req.user mirrors the JWT payload
// signed in routes/auth.js: { sub, username, role, mustChangePassword, securityQuestionsSet }.
export function requireAuth(req, res, next) {
  const { JWT_SECRET } = process.env;
  if (!JWT_SECRET) {
    console.error("JWT_SECRET is not set — all authenticated routes are disabled");
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  const header = req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "Missing token" });
    return;
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
