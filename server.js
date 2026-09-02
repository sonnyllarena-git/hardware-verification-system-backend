import express from "express";
import cors from "cors";
import resultsRouter from "./routes/results.js";
import submitRouter from "./routes/submit.js";
import applicantsRouter from "./routes/applicants.js";

const app = express();

// Configure CORS to allow frontend domain
const corsOptions = {
  origin: [
    "https://hardware-verification-system-fronte.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173" // Vite dev server
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.json({ message: "TCP Hardware Verification API is running", status: "ok" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/results", resultsRouter);
app.use("/api/submit-hardware-check", submitRouter);
app.use("/api", applicantsRouter);

// Only start server locally, NOT on Vercel
if (process.env.NODE_ENV !== "test" && process.env.VERCEL !== "1") {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`API listening on port ${port}`));
}

// Export handler function for Vercel serverless
export default (req, res) => app(req, res);