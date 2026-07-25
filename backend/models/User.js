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
      // Password is only required if they are not using Google OAuth
      return !this.google_id;
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
  }
}, {
  timestamps: { createdAt: "created_date", updatedAt: "updated_date" }
});

// Hash password before saving
userSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
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
