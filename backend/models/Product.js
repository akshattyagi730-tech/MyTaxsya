import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
  },
  barcode: {
    type: String,
  },
  hsn_code: {
    type: String,
  },
  gst_rate: {
    type: Number,
    default: 18,
  },
  category: {
    type: String,
  },
  description: {
    type: String,
  },
  purchase_price: {
    type: Number,
    default: 0,
  },
  selling_price: {
    type: Number,
    default: 0,
  },
  unit: {
    type: String,
    default: "PCS",
  },
  stock_quantity: {
    type: Number,
    default: 0,
  },
  low_stock_threshold: {
    type: Number,
    default: 10,
  },
  image_url: {
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

const Product = mongoose.model("Product", productSchema);
export default Product;
