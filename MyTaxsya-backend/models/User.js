import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: function() {
      // Not required for Google sign-in users, nor for a team member who has been
      // invited but has not chosen a password yet.
      return !this.google_id && !this.invite_pending;
    },
  },
  role: {
    type: String,
    enum: ["admin", "user"],
    default: "user",
  },
  full_name: {
    type: String,
    default: "",
  },
  google_id: {
    type: String,
    default: null,
  },
  refresh_token: {
    type: String,
    default: null,
  },
  invite_pending: {
    type: Boolean,
    default: false,
  }
}, {
  timestamps: { createdAt: "created_date", updatedAt: "updated_date" },
  toJSON: {
    virtuals: true,
    // Secrets must never leave the server, whichever code path serialises a user.
    transform: function (doc, ret) {
      ret.id = String(ret._id);
      delete ret.password;
      delete ret.refresh_token;
      delete ret.google_id;
      delete ret.__v;
      return ret;
    }
  }
});

// Hash password before saving
userSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  // Set by sign-up: the password was already bcrypt-hashed when the OTP was requested.
  if (this.$locals.passwordAlreadyHashed) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;
