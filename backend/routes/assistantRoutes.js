import express from "express";
import { invokeAssistant, extractInvoiceData } from "../controllers/assistantController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.post("/chat", protect, invokeAssistant);
router.post("/extract-invoice", protect, extractInvoiceData);

export default router;
