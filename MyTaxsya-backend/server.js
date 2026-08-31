import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import entityRoutes from "./routes/entityRoutes.js";
import assistantRoutes from "./routes/assistantRoutes.js";

// Load environment variables
dotenv.config();

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

// Middleware
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5175")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header (health checks, curl) are safe to allow.
    if (!origin || process.env.NODE_ENV !== "production" || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

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
      error: "Request payload is too large. Maximum supported size is 100 MB.",
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
