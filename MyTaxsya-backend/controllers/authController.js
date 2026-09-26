import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import PendingRegistration from "../models/PendingRegistration.js";
import { getAccessSecret, getRefreshSecret, getFrontendOrigin } from "../config/env.js";
import { sendEmail, otpEmail, passwordResetEmail, inviteEmail } from "../services/emailService.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_RESENDS = 3;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const ROLES = ["admin", "user"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMAIL_UNAVAILABLE = {
  error: "We could not send the email right now. Please try again in a few minutes.",
  code: "EMAIL_UNAVAILABLE",
};

// Compared against when the account does not exist, so login takes about as long
// either way and response time does not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const normalizeEmail = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const isValidEmail = (email) => email.length <= 254 && EMAIL_RE.test(email);

const passwordProblem = (password) => {
  if (typeof password !== "string" || !password) return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
};

const publicUser = (user) => ({
  id: user._id,
  email: user.email,
  role: user.role,
  full_name: user.full_name,
  created_date: user.created_date,
  updated_date: user.updated_date,
});

// --- Tokens -------------------------------------------------------------------

const generateAccessToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role, typ: "access" },
    getAccessSecret(),
    { expiresIn: "15m", algorithm: "HS256" }
  );

const generateRefreshToken = (user) =>
  jwt.sign(
    { id: user._id, typ: "refresh" },
    getRefreshSecret(),
    { expiresIn: "7d", algorithm: "HS256" }
  );

// Reset/invite tokens are signed with a key that includes the user's current
// password hash. Setting a new password therefore kills the token (single use),
// and they can never be replayed as an access token (different key + purpose).
const resetSecret = (user) => `${getAccessSecret()}|password-reset|${user.password || ""}`;

const signResetToken = (user, expiresIn) =>
  jwt.sign({ id: user._id, typ: "reset" }, resetSecret(user), { expiresIn, algorithm: "HS256" });

const verifyResetToken = async (token) => {
  const unverified = jwt.decode(token);
  if (!unverified || typeof unverified !== "object" || !mongoose.isValidObjectId(unverified.id)) {
    throw new Error("Malformed reset token");
  }
  const user = await User.findById(unverified.id);
  if (!user) throw new Error("User not found");
  const payload = jwt.verify(token, resetSecret(user), { algorithms: ["HS256"] });
  if (payload.typ !== "reset") throw new Error("Wrong token type");
  return user;
};

// --- Sign-up OTP --------------------------------------------------------------

const generateOtp = () => String(crypto.randomInt(100000, 1000000));

const hashOtp = (email, otp) =>
  crypto.createHmac("sha256", getAccessSecret()).update(`${email}:${otp}`).digest("hex");

const otpMatches = (storedHash, email, otp) => {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashOtp(email, otp), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const registerUser = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const { password, full_name } = req.body || {};

  if (!isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required" });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  try {
    if (await User.exists({ email })) {
      return res.status(400).json({ error: "User already exists" });
    }

    const existing = await PendingRegistration.findOne({ email });
    if (existing && Date.now() - existing.last_sent_at.getTime() < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: "A code was just sent. Please wait a few seconds before trying again.", code: "RATE_LIMITED" });
    }

    const otp = generateOtp();
    await PendingRegistration.findOneAndUpdate(
      { email },
      {
        email,
        password_hash: await bcrypt.hash(password, 10),
        full_name: typeof full_name === "string" && full_name.trim() ? full_name.trim().slice(0, 100) : email.split("@")[0],
        otp_hash: hashOtp(email, otp),
        attempts: 0,
        resend_count: 0,
        last_sent_at: new Date(),
        expires_at: new Date(Date.now() + OTP_TTL_MS),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await sendEmail(otpEmail({ to: email, otp }));
    } catch (mailError) {
      console.error("Verification email failed:", mailError.message);
      await PendingRegistration.deleteOne({ email });
      return res.status(503).json(EMAIL_UNAVAILABLE);
    }

    res.status(200).json({
      success: true,
      message: "Verification code sent successfully to email",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const verifyOtp = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const rawCode = req.body?.otpCode;
  const otpCode = typeof rawCode === "number" ? String(rawCode) : rawCode;

  if (!isValidEmail(email) || typeof otpCode !== "string" || !/^\d{6}$/.test(otpCode.trim())) {
    return res.status(400).json({ error: "Invalid verification code" });
  }

  try {
    const pending = await PendingRegistration.findOne({ email });
    if (!pending || pending.expires_at.getTime() <= Date.now()) {
      if (pending) await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({ error: "Registration session not found or expired. Please sign up again." });
    }

    // Count this attempt atomically *before* comparing, so parallel requests
    // cannot squeeze extra guesses past the cap.
    const attempt = await PendingRegistration.findOneAndUpdate(
      { _id: pending._id, attempts: { $lt: MAX_OTP_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!attempt) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(429).json({ error: "Too many incorrect attempts. Please sign up again.", code: "RATE_LIMITED" });
    }

    if (!otpMatches(attempt.otp_hash, email, otpCode.trim())) {
      const left = MAX_OTP_ATTEMPTS - attempt.attempts;
      return res.status(400).json({ error: left > 0 ? `Invalid verification code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Invalid verification code" });
    }

    if (await User.exists({ email })) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({ error: "User already registered" });
    }

    // Set first user as admin, others as users
    const isFirstUser = (await User.countDocuments({})) === 0;
    const user = new User({
      email,
      password: attempt.password_hash,
      full_name: attempt.full_name,
      role: isFirstUser ? "admin" : "user",
    });
    user.$locals.passwordAlreadyHashed = true;
    await user.save();
    delete user.$locals.passwordAlreadyHashed;
    await PendingRegistration.deleteOne({ _id: pending._id });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    user.refresh_token = refreshToken;
    await user.save();

    res.status(201).json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: "User already registered" });
    res.status(500).json({ error: error.message });
  }
};

export const resendOtp = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required" });

  try {
    const pending = await PendingRegistration.findOne({ email });
    if (!pending || pending.expires_at.getTime() <= Date.now()) {
      return res.status(400).json({ error: "Registration session not found. Please sign up again." });
    }
    if (pending.resend_count >= MAX_OTP_RESENDS) {
      return res.status(429).json({ error: "Too many code requests. Please sign up again.", code: "RATE_LIMITED" });
    }
    if (Date.now() - pending.last_sent_at.getTime() < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: "A code was just sent. Please wait a few seconds before requesting another.", code: "RATE_LIMITED" });
    }

    const otp = generateOtp();
    await PendingRegistration.updateOne(
      { _id: pending._id },
      {
        $set: {
          otp_hash: hashOtp(email, otp),
          attempts: 0,
          last_sent_at: new Date(),
          expires_at: new Date(Date.now() + OTP_TTL_MS),
        },
        $inc: { resend_count: 1 },
      }
    );

    try {
      await sendEmail(otpEmail({ to: email, otp }));
    } catch (mailError) {
      console.error("Verification email failed:", mailError.message);
      return res.status(503).json(EMAIL_UNAVAILABLE);
    }

    res.json({ success: true, message: "New verification code sent successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Sessions -----------------------------------------------------------------

export const loginUser = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (!email || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ email });
    const isMatch = user ? await user.comparePassword(password) : await bcrypt.compare(password, DUMMY_HASH).then(() => false);
    if (!isMatch) {
      // Same answer whether the account is missing or the password is wrong.
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refresh_token = refreshToken;
    await user.save();

    res.json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: publicUser(user),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -refresh_token");
    if (!user) {
      return res.status(404).json({ error: "Unable to read data for the current user" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const refreshToken = async (req, res) => {
  const { refresh_token } = req.body || {};

  if (typeof refresh_token !== "string" || !refresh_token) {
    return res.status(400).json({ error: "Refresh token is required" });
  }

  try {
    const decoded = jwt.verify(refresh_token, getRefreshSecret(), { algorithms: ["HS256"] });

    const user = await User.findById(decoded.id);
    if (!user || user.refresh_token !== refresh_token) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    res.json({ access_token: generateAccessToken(user) });
  } catch (error) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
};

export const logoutUser = async (req, res) => {
  const { refresh_token } = req.body || {};
  try {
    // A string only: an object here would be a Mongo operator ({$ne: null}) that
    // signs out an arbitrary user.
    if (typeof refresh_token === "string" && refresh_token) {
      await User.updateOne({ refresh_token }, { $set: { refresh_token: null } });
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- Google OAuth -------------------------------------------------------------

// Initiate Google OAuth login (redirects user to Google Accounts)
export const googleLogin = (req, res) => {
  const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
  const options = {
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:5001/api/auth/google/callback",
    client_id: process.env.GOOGLE_CLIENT_ID || "your_google_client_id_here",
    access_type: "offline",
    response_type: "code",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email"
    ].join(" ")
  };

  const queryString = new URLSearchParams(options).toString();
  res.redirect(`${rootUrl}?${queryString}`);
};

// Handle Google OAuth callback
export const googleCallback = async (req, res) => {
  const { code } = req.query;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5001/api/auth/google/callback";
  const frontendOrigin = getFrontendOrigin();

  if (typeof code !== "string" || !code) {
    return res.redirect(`${frontendOrigin}/login?error=Google authentication failed`);
  }

  try {
    // 1. Exchange authorization code for tokens
    const tokenUrl = "https://oauth2.googleapis.com/token";
    const tokenOptions = {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "your_google_client_id_here",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "your_google_client_secret_here",
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    };

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenOptions).toString()
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    const { access_token } = tokenData;

    // 2. Fetch user profile information using the access token
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const userData = await userRes.json();
    const { id: google_id, name: full_name } = userData;
    const email = normalizeEmail(userData.email);

    // An unverified Google email must not be able to claim (or link to) an
    // existing account that uses the same address.
    if (!isValidEmail(email) || userData.verified_email !== true) {
      throw new Error("Your Google account email is not verified");
    }

    // 3. Find or create user
    let user = await User.findOne({ email });

    if (!user) {
      // First user is admin, others are user
      const isFirstUser = (await User.countDocuments({})) === 0;
      const role = isFirstUser ? "admin" : "user";

      user = await User.create({
        email,
        full_name,
        google_id,
        role
      });
    } else if (!user.google_id) {
      user.google_id = google_id;
      if (!user.full_name) user.full_name = full_name;
      await user.save();
    }

    const appAccessToken = generateAccessToken(user);
    const appRefreshToken = generateRefreshToken(user);

    user.refresh_token = appRefreshToken;
    await user.save();

    // 4. Redirect user back to frontend with the tokens and navigation query parameters
    res.redirect(`${frontendOrigin}/?access_token=${appAccessToken}&refresh_token=${appRefreshToken}&from_url=/`);
  } catch (error) {
    console.error("Google OAuth error:", error.message);
    res.redirect(`${frontendOrigin}/login?error=${encodeURIComponent(error.message)}`);
  }
};

// --- Password reset & invites -------------------------------------------------

export const forgotPassword = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const generic = { success: true, message: "If the email exists, a reset link has been sent" };

  // Always the same answer, so the endpoint cannot be used to discover accounts.
  if (!isValidEmail(email)) return res.json(generic);

  try {
    const user = await User.findOne({ email });
    if (user) {
      const link = `${getFrontendOrigin()}/reset-password?token=${encodeURIComponent(signResetToken(user, "1h"))}`;
      try {
        await sendEmail(passwordResetEmail({ to: email, link }));
      } catch (mailError) {
        console.error("Password reset email failed:", mailError.message);
      }
    }
    res.json(generic);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body || {};

  if (typeof resetToken !== "string" || !resetToken) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const user = await verifyResetToken(resetToken);

    user.password = newPassword;
    user.invite_pending = false;
    // Changing the password signs the account out everywhere else.
    user.refresh_token = null;
    await user.save();

    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    res.status(400).json({ error: "Invalid or expired reset token" });
  }
};

export const inviteUser = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const role = req.body?.role ?? "user";

  if (!isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(", ")}` });

  try {
    if (await User.exists({ email })) {
      return res.status(400).json({ error: "User already exists or has been invited" });
    }

    const user = await User.create({
      email,
      role,
      full_name: email.split("@")[0],
      invite_pending: true,
    });

    try {
      const link = `${getFrontendOrigin()}/reset-password?token=${encodeURIComponent(signResetToken(user, "3d"))}`;
      await sendEmail(inviteEmail({ to: email, link, invitedBy: req.user.full_name || req.user.email }));
    } catch (mailError) {
      console.error("Invite email failed:", mailError.message);
      await User.deleteOne({ _id: user._id });
      return res.status(503).json(EMAIL_UNAVAILABLE);
    }

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
