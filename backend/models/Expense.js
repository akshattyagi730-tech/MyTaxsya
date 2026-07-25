import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    enum: ["rent", "salaries", "utilities", "marketing", "travel", "office_supplies", "software", "professional_fees", "raw_materials", "logistics", "other"],
    default: "other",
  },
  amount: {
    type: Number,
    required: true,
    default: 0,
  },
  payment_mode: {
    type: String,
    enum: ["cash", "upi", "bank", "card", "cheque"],
    default: "upi",
  },
  date: {
    type: Date,
    required: true,
  },
  vendor: {
    type: String,
  },
  gst_amount: {
    type: Number,
    default: 0,
  },
  notes: {
    type: String,
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
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

const Expense = mongoose.model("Expense", expenseSchema);
export default Expense;
