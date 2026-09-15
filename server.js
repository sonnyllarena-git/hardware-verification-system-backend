import express from "express";
import cors from "cors";
import resultsRouter from "./routes/results.js";
import submitRouter from "./routes/submit.js";
import applicantsRouter from "./routes/applicants.js";
import complianceRequirementsRouter from "./routes/complianceRequirements.js";

const app = express();

// Configure CORS to allow frontend domain
const corsOptions = {
  origin: [
    "https://hardware-verification-system-fronte.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173", // Vite dev server
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static("public"));

// Every /api response varies by the request's Origin header (cors() reflects it back into
// Access-Control-Allow-Origin per-request). Vercel's edge network otherwise treats GET
// responses as publicly cacheable by default, and its cache doesn't reliably vary by Origin
// the way `Vary: Origin` asks it to — one origin's request can get served another origin's
// cached response, silently breaking CORS for everyone but the first cached caller. no-store
// opts every API response out of that shared cache entirely.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/", (req, res) => {
  res.json({ message: "TCP Hardware Verification API is running", status: "ok" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/results", resultsRouter);
app.use("/api/submit-hardware-check", submitRouter);
app.use("/api", applicantsRouter);
app.use("/api", complianceRequirementsRouter);

// Only start server locally, NOT on Vercel
if (process.env.NODE_ENV !== "test" && process.env.VERCEL !== "1") {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`API listening on port ${port}`));
}

// Export handler function for Vercel serverless
export default (req, res) => app(req, res);
