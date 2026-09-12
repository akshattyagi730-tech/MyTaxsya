import mongoose from "mongoose";

// A bill RECEIVED from a supplier — distinct from Invoice (which is what this
// business ISSUES to its own customers). This is the real source of Input Tax
// Credit (ITC): GST paid on purchases can only be claimed back through a
// properly recorded purchase bill, not through the generic Expense model
// (which has no concept of GST-eligibility, HSN, or per-line tax breakdown).
const purchaseBillItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  hsn: { type: String },
  quantity: { type: Number, default: 1 },
  rate: { type: Number, default: 0 },
  taxable_value: { type: Number, default: 0 },
  gst_rate: { type: Number, default: 18 },
}, { _id: false });

const purchaseBillSchema = new mongoose.Schema({
  bill_number: {
    type: String,
    required: true,
  },
  supplier_id: {
    type: String,
  },
  supplier_name: {
    type: String,
    required: true,
  },
  supplier_gstin: {
    type: String,
  },
  bill_date: {
    type: Date,
    required: true,
  },
  due_date: {
    type: Date,
  },
  items: {
    type: [purchaseBillItemSchema],
    default: [],
  },
  taxable_value: {
    type: Number,
    default: 0,
  },
  discount: {
    type: Number,
    default: 0,
  },
  cgst: {
    type: Number,
    default: 0,
  },
  sgst: {
    type: Number,
    default: 0,
  },
  igst: {
    type: Number,
    default: 0,
  },
  round_off: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    default: 0,
  },
  // Whether GST paid on this bill can actually be claimed as Input Tax
  // Credit. Not every GST-bearing purchase is ITC-eligible under Section
  // 17(5) of the CGST Act — this keeps that distinction explicit instead of
  // assuming every taxed expense is automatically creditable.
  itc_eligible: {
    type: Boolean,
    default: true,
  },
  itc_ineligible_reason: {
    type: String,
    enum: [
      "", "motor_vehicle", "food_beverage_outdoor_catering",
      "employee_benefit", "personal_use", "works_contract_immovable_property",
      "membership_club_fitness", "other_blocked",
    ],
    default: "",
  },
  // Whether this bill counts as a real, finalized transaction. Mirrors the
  // draft/issued distinction GST Center already applies to sales invoices —
  // a draft purchase bill shouldn't feed into ITC until it's recorded.
  status: {
    type: String,
    enum: ["draft", "recorded"],
    default: "draft",
  },
  payment_status: {
    type: String,
    enum: ["unpaid", "partial", "paid"],
    default: "unpaid",
  },
  notes: {
    type: String,
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

const PurchaseBill = mongoose.model("PurchaseBill", purchaseBillSchema);
export default PurchaseBill;
