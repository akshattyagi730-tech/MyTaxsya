import express from "express";
import { invokeAssistant, extractInvoiceData, getAiMetrics } from "../controllers/assistantController.js";
import { protect } from "../middleware/auth.js";
import { handleMulterUpload } from "../middleware/upload.js";

const router = express.Router();

router.post("/chat", protect, invokeAssistant);
router.get("/ai-metrics", protect, getAiMetrics);

// /extract-invoice supports single or multiple files via multipart/form-data or JSON payload
router.post("/extract-invoice", protect, handleMulterUpload("file"), extractInvoiceData);

export default router;
