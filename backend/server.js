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

const app = express();

// Middleware
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// REST API Routes
app.use("/api/auth", authRoutes);
app.use("/api/entities", entityRoutes);
app.use("/api/assistant", assistantRoutes);

// Base Route
app.get("/", (req, res) => {
  res.json({ message: "GST AI Business Management Backend API is running." });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).json({ error: err.message || "An unexpected server error occurred" });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
});
