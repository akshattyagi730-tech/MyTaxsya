import mongoose from "mongoose";

// A sign-up waiting for its email OTP. Stored in MongoDB rather than process
// memory so it survives restarts, sleeping free-tier instances and serverless
// cold starts. The password is already bcrypt-hashed and the OTP is an HMAC, so
// nothing in here is usable if the collection leaks.
const pendingRegistrationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password_hash: { type: String, required: true },
  full_name: { type: String, default: "" },
  otp_hash: { type: String, required: true },
  // Wrong guesses against the current code. Incremented atomically *before* the
  // comparison, so parallel requests cannot exceed the cap.
  attempts: { type: Number, default: 0 },
  resend_count: { type: Number, default: 0 },
  last_sent_at: { type: Date, default: Date.now },
  expires_at: { type: Date, required: true },
}, { timestamps: true });

// MongoDB removes the document shortly after expires_at.
pendingRegistrationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const PendingRegistration = mongoose.model("PendingRegistration", pendingRegistrationSchema);
export default PendingRegistration;
