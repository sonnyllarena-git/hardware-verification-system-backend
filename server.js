import express from "express";
import cors from "cors";
import resultsRouter from "./routes/results.js";
import submitRouter from "./routes/submit.js";
import applicantsRouter from "./routes/applicants.js";

export const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/results", resultsRouter);
app.use("/api/submit-hardware-check", submitRouter);
app.use("/api", applicantsRouter);

if (process.env.NODE_ENV !== "test") {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`API listening on port ${port}`));
}
