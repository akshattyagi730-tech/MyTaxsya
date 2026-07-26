import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
  payment_number: {
    type: String,
    required: true,
  },
  invoice_id: {
    type: String,
  },
  customer_id: {
    type: String,
  },
  customer_name: {
    type: String,
  },
  amount: {
    type: Number,
    required: true,
    default: 0,
  },
  payment_mode: {
    type: String,
    enum: ["cash", "upi", "bank", "card", "cheque", "online"],
    default: "upi",
  },
  date: {
    type: Date,
    required: true,
  },
  reference_number: {
    type: String,
  },
  notes: {
    type: String,
  },
  status: {
    type: String,
    enum: ["success", "pending", "failed"],
    default: "success",
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

const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
