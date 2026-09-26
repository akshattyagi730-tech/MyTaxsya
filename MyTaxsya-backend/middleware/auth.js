import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { getAccessSecret } from "../config/env.js";

export const protect = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authorized, no token provided" });
  }

  let decoded;
  try {
    decoded = jwt.verify(header.split(" ")[1], getAccessSecret(), { algorithms: ["HS256"] });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Not authorized, token failed" });
  }

  // Only access tokens may authenticate a request. Refresh and password-reset
  // tokens are signed with different keys, but check the purpose regardless.
  if (decoded.typ !== "access" || !mongoose.isValidObjectId(decoded.id)) {
    return res.status(401).json({ error: "Not authorized, token failed" });
  }

  try {
    // The user must still exist: a deleted account's token stops working immediately.
    const user = await User.findById(decoded.id).select("-password -refresh_token");
    if (!user) {
      return res.status(401).json({ error: "User not found or deleted" });
    }
    req.user = user;
    next();
  } catch (dbErr) {
    console.error("DB user lookup failed in auth middleware:", dbErr.message);
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ error: "Access denied, admin role required" });
  }
};
