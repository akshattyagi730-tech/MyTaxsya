import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["info", "success", "warning", "error"],
    default: "info",
  },
  category: {
    type: String,
    enum: ["invoice", "payment", "expense", "gst", "inventory", "system"],
    default: "system",
  },
  read: {
    type: Boolean,
    default: false,
  },
  link: {
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

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
