import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import entityRoutes from "./routes/entityRoutes.js";
import assistantRoutes from "./routes/assistantRoutes.js";
import { assertProductionEnv, isOriginAllowed } from "./config/env.js";

// Load environment variables
dotenv.config();

// Refuse to boot in production with missing or weak signing secrets
assertProductionEnv();

// Connect to Database
connectDB();

// Global Process Crash Prevention
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection caught (process protected):", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception caught (process protected):", error);
  if (error.code === "EADDRINUSE") {
    process.exit(1);
  }
});

const app = express();

// Render/Vercel sit behind one proxy hop; without this every client shares the
// proxy's IP and per-IP rate limits would throttle everybody together.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Middleware
app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header (health checks, curl) are safe to allow.
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
}));

// Body-size limits per route group. Only the AI upload route needs 100 MB
// (base64 documents); everything reachable without logging in stays small so it
// cannot be used to exhaust memory. A body is parsed by the first matching
// parser only, so the specific ones must be registered before the default.
app.use("/api/assistant", express.json({ limit: "100mb" }), express.urlencoded({ limit: "100mb", extended: true }));
app.use("/api/entities", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ limit: "100kb", extended: true }));

// REST API Routes
app.use("/api/auth", authRoutes);
app.use("/api/entities", entityRoutes);
app.use("/api/assistant", assistantRoutes);

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Base Route
app.get("/", (req, res) => {
  res.json({ message: "GST AI Business Management Backend API is running." });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  if (err.type === "entity.too.large" || err.status === 413 || err.statusCode === 413) {
    return res.status(413).json({
      error: "Request payload is too large.",
      code: "PAYLOAD_TOO_LARGE"
    });
  }
  res.status(err.status || err.statusCode || 500).json({ error: err.message || "An unexpected server error occurred" });
});

// Vercel imports the Express app as a serverless function. Keep a local listener
// for Render and local development only.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
  });
}

export default app;
