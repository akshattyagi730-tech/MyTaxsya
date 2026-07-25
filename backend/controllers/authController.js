import jwt from "jsonwebtoken";
import User from "../models/User.js";

const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "your_jwt_access_secret_key_here",
    { expiresIn: "15m" }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET || "your_jwt_refresh_secret_key_here",
    { expiresIn: "7d" }
  );
};

// In-memory store for pending user registrations and OTPs
const pendingRegistrations = new Map();

export const registerUser = async (req, res) => {
  const { email, password, full_name } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store temporarily
    pendingRegistrations.set(email, {
      password,
      full_name: full_name || email.split("@")[0],
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes expiry
    });

    console.log(`\n==========================================\n[SMTP MOCK] Verification code for ${email}: ${otp}\n==========================================\n`);

    res.status(200).json({
      success: true,
      message: "Verification code sent successfully to email"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const verifyOtp = async (req, res) => {
  const { email, otpCode } = req.body;

  try {
    const pending = pendingRegistrations.get(email);
    if (!pending) {
      return res.status(400).json({ error: "Registration session not found or expired. Please sign up again." });
    }

    if (pending.otp !== otpCode) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    if (Date.now() > pending.expiresAt) {
      pendingRegistrations.delete(email);
      return res.status(400).json({ error: "Verification code has expired. Please sign up again." });
    }

    // Check one last time if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      pendingRegistrations.delete(email);
      return res.status(400).json({ error: "User already registered" });
    }

    // Set first user as admin, others as users
    const isFirstUser = (await User.countDocuments({})) === 0;
    const role = isFirstUser ? "admin" : "user";

    const user = await User.create({
      email,
      password: pending.password,
      full_name: pending.full_name,
      role
    });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refresh_token = refreshToken;
    await user.save();

    // Clear session
    pendingRegistrations.delete(email);

    res.status(201).json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
        created_date: user.created_date,
        updated_date: user.updated_date,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const resendOtp = async (req, res) => {
  const { email } = req.body;

  try {
    const pending = pendingRegistrations.get(email);
    if (!pending) {
      return res.status(400).json({ error: "Registration session not found. Please sign up again." });
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    pending.otp = otp;
    pending.expiresAt = Date.now() + 10 * 60 * 1000;
    pendingRegistrations.set(email, pending);

    console.log(`\n==========================================\n[SMTP MOCK] New verification code for ${email}: ${otp}\n==========================================\n`);

    res.json({ success: true, message: "New verification code sent successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "Account does not exist" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
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
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
        created_date: user.created_date,
        updated_date: user.updated_date,
      },
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
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: "Refresh token is required" });
  }

  try {
    const decoded = jwt.verify(
      refresh_token,
      process.env.JWT_REFRESH_SECRET || "your_jwt_refresh_secret_key_here"
    );

    const user = await User.findById(decoded.id);
    if (!user || user.refresh_token !== refresh_token) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const newAccessToken = generateAccessToken(user);
    res.json({
      access_token: newAccessToken,
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
};

export const logoutUser = async (req, res) => {
  const { refresh_token } = req.body;
  try {
    if (refresh_token) {
      const user = await User.findOne({ refresh_token });
      if (user) {
        user.refresh_token = null;
        await user.save();
      }
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Initiate Google OAuth login (redirects user to Google Accounts)
export const googleLogin = (req, res) => {
  const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
  const options = {
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:5175/api/auth/google/callback",
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
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5175/api/auth/google/callback";
  const frontendOrigin = new URL(redirectUri).origin;

  if (!code) {
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

    const { id_token, access_token } = tokenData;

    // 2. Fetch user profile information using the access token
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const userData = await userRes.json();
    const { id: google_id, email, name: full_name } = userData;

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

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: true, message: "If the email exists, a reset link has been sent" });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "your_jwt_access_secret_key_here",
      { expiresIn: "1h" }
    );

    console.log(`\n==========================================\n[SMTP MOCK] Password reset link for ${email}:\nhttp://localhost:5175/reset-password?token=${token}\n==========================================\n`);

    res.json({ success: true, message: "If the email exists, a reset link has been sent" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body;
  try {
    const decoded = jwt.verify(
      resetToken,
      process.env.JWT_SECRET || "your_jwt_access_secret_key_here"
    );

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    res.status(400).json({ error: "Invalid or expired reset token" });
  }
};

export const inviteUser = async (req, res) => {
  const { email, role } = req.body;
  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ error: "User already exists or has been invited" });
    }

    const user = await User.create({
      email,
      role: role || "user",
      full_name: email.split("@")[0]
    });

    console.log(`\n==========================================\n[SMTP MOCK] Invited user ${email} with role ${role}\n==========================================\n`);

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
