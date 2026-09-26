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
import { rateLimit, byIp, byIpAndEmail } from "../middleware/rateLimit.js";

const router = express.Router();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const limits = {
  register: rateLimit({ windowMs: HOUR, max: 20, key: byIp, message: "Too many sign-up attempts. Please try again later." }),
  verifyOtp: rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byIpAndEmail, message: "Too many verification attempts. Please try again later." }),
  resendOtp: rateLimit({ windowMs: 10 * MINUTE, max: 5, key: byIpAndEmail, message: "Too many code requests. Please try again later." }),
  // Only failures count, so a normal user logging in and out is never throttled.
  login: rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byIpAndEmail, skipSuccessfulRequests: true, message: "Too many failed login attempts. Please try again in a few minutes." }),
  forgotPassword: rateLimit({ windowMs: HOUR, max: 5, key: byIpAndEmail, message: "Too many reset requests. Please try again later." }),
  resetPassword: rateLimit({ windowMs: HOUR, max: 10, key: byIp, message: "Too many attempts. Please try again later." }),
  invite: rateLimit({ windowMs: HOUR, max: 30, key: (req) => String(req.user?.id), message: "Too many invitations sent. Please try again later." }),
};

router.post("/register", limits.register, registerUser);
router.post("/verify-otp", limits.verifyOtp, verifyOtp);
router.post("/resend-otp", limits.resendOtp, resendOtp);
router.post("/login", limits.login, loginUser);
router.get("/me", protect, getMe);
router.post("/refresh", refreshToken);
router.post("/logout", logoutUser);
router.post("/forgot-password", limits.forgotPassword, forgotPassword);
router.post("/reset-password", limits.resetPassword, resetPassword);
router.post("/invite", protect, adminOnly, limits.invite, inviteUser);

// Google OAuth
router.get("/google", googleLogin);
router.get("/google/callback", googleCallback);

export default router;
