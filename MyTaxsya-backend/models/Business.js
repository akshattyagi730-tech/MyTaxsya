import mongoose from "mongoose";

const businessSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  legal_name: {
    type: String,
  },
  gstin: {
    type: String,
  },
  pan: {
    type: String,
  },
  email: {
    type: String,
  },
  phone: {
    type: String,
  },
  address: {
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
  logo_url: {
    type: String,
  },
  bank_name: { type: String },
  bank_account: { type: String },
  bank_ifsc: { type: String },
  upi_id: { type: String },
  invoice_terms: { type: String },
  business_type: {
    type: String,
    enum: ["proprietorship", "partnership", "llp", "private_limited", "public_limited", "huf", "trust"],
    default: "proprietorship",
  },
  financial_year_start: {
    type: Date,
  },
  currency_symbol: {
    type: String,
    default: "₹",
  },
  gst_enabled: {
    type: Boolean,
    default: true,
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

const Business = mongoose.model("Business", businessSchema);
export default Business;
