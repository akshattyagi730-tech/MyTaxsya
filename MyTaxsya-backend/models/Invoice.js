import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema({
  invoice_number: {
    type: String,
    required: true,
  },
  customer_id: {
    type: String,
    required: true,
  },
  customer_name: {
    type: String,
  },
  invoice_date: {
    type: Date,
  },
  due_date: {
    type: Date,
  },
  status: {
    type: String,
    enum: ["draft", "sent", "paid", "overdue", "cancelled"],
    default: "draft",
  },
  subtotal: {
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
  cess: {
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
  paid_amount: {
    type: Number,
    default: 0,
  },
  balance_due: {
    type: Number,
    default: 0,
  },
  notes: {
    type: String,
  },
  ai_confidence: {
    type: Number,
    min: 0,
    max: 1,
  },
  ai_category: {
    type: String,
  },
  items: {
    type: Array,
    default: [],
  },
  created_by: {
    type: String,
    required: true,
  },
  original_filename: {
    type: String,
  },
  extraction_method: {
    type: String,
  },
  extraction_confidence: {
    type: Number,
  },
  warnings: {
    type: [String],
    default: [],
  },
  source_document_id: {
    type: String,
  },
  invoice_date_raw: {
    type: String,
  },
  due_date_raw: {
    type: String,
  },
  validation_status: {
    type: String,
    enum: ["SUCCESS", "NEEDS_REVIEW", "FAILED", "success", "needs_review", "failed"],
    default: "SUCCESS",
  },
  field_validation: {
    type: Object,
    default: {},
  },
  jobId: {
    type: String,
  },
  raw_data: {
    type: Object,
  },
  extraction_timestamp: {
    type: Date,
    default: Date.now,
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

const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;
