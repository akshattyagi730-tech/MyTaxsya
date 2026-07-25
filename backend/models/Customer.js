import mongoose from "mongoose";

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
  },
  phone: {
    type: String,
  },
  gstin: {
    type: String,
  },
  billing_address: {
    type: String,
  },
  city: {
    type: String,
  },
  state: {
    type: String,
  },
  pincode: {
    type: String,
  },
  opening_balance: {
    type: Number,
    default: 0,
  },
  credit_limit: {
    type: Number,
    default: 0,
  },
  notes: {
    type: String,
  },
  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },
  created_by: {
    type: String,
    required: true,
  }
}, {
  timestamps: { createdAt: "created_date", updatedAt: "updated_date" },
  toJSON: {
    virtuals: true,
    transform: function (doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

const Customer = mongoose.model("Customer", customerSchema);
export default Customer;
