import express from "express";
import {
  registerUser,
  verifyOtp,
  resendOtp,
  loginUser,
  getMe,
  refreshToken,
  logoutUser,
  googleLogin,
  googleCallback,
  forgotPassword,
  resetPassword,
  inviteUser
} from "../controllers/authController.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);
router.post("/login", loginUser);
router.get("/me", protect, getMe);
router.post("/refresh", refreshToken);
router.post("/logout", logoutUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/invite", protect, adminOnly, inviteUser);

// Google OAuth
router.get("/google", googleLogin);
router.get("/google/callback", googleCallback);

export default router;
