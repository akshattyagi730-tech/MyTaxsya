import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Decode token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_access_secret_key_here");

      // Find user in DB or fallback to token payload
      try {
        req.user = await User.findById(decoded.id).select("-password");
      } catch (dbErr) {
        console.warn("DB user lookup warning in auth middleware:", dbErr.message);
      }
      if (!req.user && decoded.email) {
        req.user = { _id: decoded.id, email: decoded.email, role: decoded.role || "user" };
      }
      if (!req.user) {
        return res.status(401).json({ error: "User not found or deleted" });
      }

      next();
    } catch (error) {
      console.error("JWT verify error:", error.message);
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Session expired", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ error: "Not authorized, token failed" });
    }
  } else {
    return res.status(401).json({ error: "Not authorized, no token provided" });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ error: "Access denied, admin role required" });
  }
};
