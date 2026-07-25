import Business from "../models/Business.js";
import Customer from "../models/Customer.js";
import Expense from "../models/Expense.js";
import Invoice from "../models/Invoice.js";
import Notification from "../models/Notification.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";

const models = {
  Business,
  Customer,
  Expense,
  Invoice,
  Notification,
  Payment,
  Product,
  Supplier,
  User
};

const getModel = (entityName) => {
  const normalized = entityName.charAt(0).toUpperCase() + entityName.slice(1);
  return models[normalized];
};

// Duplicate prevention validation
const checkDuplicates = async (Model, body, userEmail, excludeId = null) => {
  const query = { created_by: userEmail };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  if (Model.modelName === "Invoice") {
    if (body.invoice_number) {
      query.invoice_number = body.invoice_number;
      const count = await Model.countDocuments(query);
      if (count > 0) throw new Error(`Invoice number "${body.invoice_number}" already exists`);
    }
  } else if (Model.modelName === "Customer") {
    if (body.name) {
      query.name = { $regex: new RegExp(`^${body.name.trim()}$`, "i") };
      const count = await Model.countDocuments(query);
      if (count > 0) throw new Error(`Customer "${body.name}" already exists`);
    }
  } else if (Model.modelName === "Supplier") {
    if (body.name) {
      query.name = { $regex: new RegExp(`^${body.name.trim()}$`, "i") };
      const count = await Model.countDocuments(query);
      if (count > 0) throw new Error(`Supplier "${body.name}" already exists`);
    }
  } else if (Model.modelName === "Product") {
    if (body.sku) {
      query.sku = body.sku;
      const count = await Model.countDocuments(query);
      if (count > 0) throw new Error(`Product SKU "${body.sku}" already exists`);
    } else if (body.name) {
      query.name = { $regex: new RegExp(`^${body.name.trim()}$`, "i") };
      const count = await Model.countDocuments(query);
      if (count > 0) throw new Error(`Product name "${body.name}" already exists`);
    }
  } else if (Model.modelName === "Payment") {
    if (body.payment_number) {
      query.payment_number = body.payment_number;
      const count = await Model.countDocuments(query);
      if (count > 0) throw new Error(`Payment number "${body.payment_number}" already exists`);
    }
  }
};

// Adjust inventory stock levels
const adjustInventoryStock = async (items, multiplier, preventNegative = false) => {
  for (const item of items) {
    if (item.product_id) {
      const product = await Product.findById(item.product_id);
      if (product) {
        const qty = Number(item.quantity) || 0;
        const newQty = product.stock_quantity + (qty * multiplier);
        if (preventNegative && newQty < 0) {
          throw new Error(`Insufficient stock for product "${product.name}". Available: ${product.stock_quantity}, Requested: ${qty}`);
        }
        product.stock_quantity = Math.max(0, newQty);
        await product.save();
      }
    }
  }
};

export const listEntities = async (req, res) => {
  const { entityName } = req.params;
  const { sort, limit = 200, skip = 0, ...filters } = req.query;

  const Model = getModel(entityName);
  if (!Model) {
    return res.status(400).json({ error: `Invalid entity: ${entityName}` });
  }

  try {
    let query = {};

    if (Model.modelName === "User") {
      if (req.user.role !== "admin") {
        query = { _id: req.user.id };
      }
    } else {
      query.created_by = req.user.email;
    }

    Object.keys(filters).forEach(key => {
      query[key] = filters[key];
    });

    let sortOption = {};
    if (sort) {
      const isDesc = sort.startsWith("-");
      const field = isDesc ? sort.substring(1) : sort;
      sortOption[field] = isDesc ? -1 : 1;
    } else {
      sortOption["created_date"] = -1;
    }

    const items = await Model.find(query)
      .sort(sortOption)
      .limit(Number(limit))
      .skip(Number(skip));

    // Dynamic Outstanding aggregation for listings
    if (Model.modelName === "Customer") {
      const customerInvoices = await Invoice.find({ created_by: req.user.email, status: { $in: ["sent", "overdue"] } });
      const outstandingMap = {};
      customerInvoices.forEach(inv => {
        const bal = inv.balance_due !== undefined ? inv.balance_due : (inv.total || 0);
        outstandingMap[inv.customer_id] = (outstandingMap[inv.customer_id] || 0) + bal;
      });
      const itemsJSON = items.map(item => {
        const obj = item.toJSON();
        obj.outstanding_amount = outstandingMap[obj.id] || 0;
        return obj;
      });
      return res.json(itemsJSON);
    }

    if (Model.modelName === "Supplier") {
      const expenses = await Expense.find({ created_by: req.user.email, status: "pending" });
      const supplierOutstandingMap = {};
      expenses.forEach(exp => {
        if (exp.vendor) {
          supplierOutstandingMap[exp.vendor.toLowerCase()] = (supplierOutstandingMap[exp.vendor.toLowerCase()] || 0) + exp.amount;
        }
      });
      const itemsJSON = items.map(item => {
        const obj = item.toJSON();
        obj.outstanding_amount = supplierOutstandingMap[obj.name.toLowerCase()] || 0;
        return obj;
      });
      return res.json(itemsJSON);
    }

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getEntity = async (req, res) => {
  const { entityName, id } = req.params;

  const Model = getModel(entityName);
  if (!Model) {
    return res.status(400).json({ error: `Invalid entity: ${entityName}` });
  }

  try {
    let query = { _id: id };
    if (Model.modelName !== "User") {
      query.created_by = req.user.email;
    } else if (req.user.role !== "admin" && req.user.id !== id) {
      return res.status(403).json({ error: "Access denied" });
    }

    const item = await Model.findOne(query);
    if (!item) {
      return res.status(404).json({ error: `${Model.modelName} not found` });
    }

    // Dynamic outstanding amount for single resource details
    if (Model.modelName === "Customer") {
      const obj = item.toJSON();
      const customerInvoices = await Invoice.find({ customer_id: id, created_by: req.user.email, status: { $in: ["sent", "overdue"] } });
      obj.outstanding_amount = customerInvoices.reduce((s, i) => s + (i.balance_due !== undefined ? i.balance_due : (i.total || 0)), 0);
      return res.json(obj);
    }

    if (Model.modelName === "Supplier") {
      const obj = item.toJSON();
      const expenses = await Expense.find({ vendor: { $regex: new RegExp(`^${item.name}$`, "i") }, created_by: req.user.email, status: "pending" });
      obj.outstanding_amount = expenses.reduce((s, e) => s + e.amount, 0);
      return res.json(obj);
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createEntity = async (req, res) => {
  const { entityName } = req.params;

  const Model = getModel(entityName);
  if (!Model) {
    return res.status(400).json({ error: `Invalid entity: ${entityName}` });
  }

  try {
    // 1. Run duplicates prevention
    if (Array.isArray(req.body)) {
      for (const item of req.body) {
        await checkDuplicates(Model, item, req.user.email);
      }
    } else {
      await checkDuplicates(Model, req.body, req.user.email);
    }

    // 2. Adjust inventory stock on active Sales Invoice creation
    if (Model.modelName === "Invoice" && !Array.isArray(req.body)) {
      const status = req.body.status;
      const isActive = status && status !== "draft" && status !== "cancelled";
      if (isActive && req.body.items) {
        await adjustInventoryStock(req.body.items, -1, true); // Reduce stock, check negative
      }
    }

    // 3. Update related Invoice status and balance due when Payment is created
    if (Model.modelName === "Payment" && !Array.isArray(req.body) && req.body.status === "success" && req.body.invoice_id) {
      const inv = await Invoice.findOne({ _id: req.body.invoice_id, created_by: req.user.email });
      if (inv) {
        const amount = Number(req.body.amount) || 0;
        inv.paid_amount += amount;
        inv.balance_due = Math.max(0, inv.total - inv.paid_amount);
        if (inv.balance_due <= 0 && inv.status !== "cancelled") {
          inv.status = "paid";
        }
        await inv.save();
      }
    }

    let result;
    if (Array.isArray(req.body)) {
      const data = req.body.map(item => {
        const mapped = { ...item };
        if (Model.modelName !== "User") {
          mapped.created_by = req.user.email;
        }
        return mapped;
      });
      result = await Model.create(data);
    } else {
      const data = { ...req.body };
      if (Model.modelName !== "User") {
        data.created_by = req.user.email;
      }
      result = await Model.create(data);
    }
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateEntity = async (req, res) => {
  const { entityName, id } = req.params;

  const Model = getModel(entityName);
  if (!Model) {
    return res.status(400).json({ error: `Invalid entity: ${entityName}` });
  }

  try {
    let query = { _id: id };
    if (Model.modelName !== "User") {
      query.created_by = req.user.email;
    } else if (req.user.role !== "admin" && req.user.id !== id) {
      return res.status(403).json({ error: "Access denied" });
    }

    // 1. Run duplicates prevention
    await checkDuplicates(Model, req.body, req.user.email, id);

    // 2. Adjust inventory stock on active Sales Invoice update
    if (Model.modelName === "Invoice") {
      const oldInv = await Invoice.findOne(query);
      if (oldInv) {
        const oldStatus = oldInv.status;
        const newStatus = req.body.status || oldInv.status;
        const oldActive = oldStatus && oldStatus !== "draft" && oldStatus !== "cancelled";
        const newActive = newStatus && newStatus !== "draft" && newStatus !== "cancelled";

        if (oldActive) {
          await adjustInventoryStock(oldInv.items || [], 1, false);
        }

        try {
          if (newActive) {
            await adjustInventoryStock(req.body.items || oldInv.items || [], -1, true);
          }
        } catch (stockErr) {
          if (oldActive) {
            await adjustInventoryStock(oldInv.items || [], -1, false);
          }
          throw stockErr;
        }
      }
    }

    // 3. Update Invoice balance on Payment update
    if (Model.modelName === "Payment") {
      const oldPayment = await Payment.findOne(query);
      if (oldPayment) {
        if (oldPayment.status === "success" && oldPayment.invoice_id) {
          const oldInv = await Invoice.findOne({ _id: oldPayment.invoice_id, created_by: req.user.email });
          if (oldInv) {
            const oldAmt = Number(oldPayment.amount) || 0;
            oldInv.paid_amount = Math.max(0, oldInv.paid_amount - oldAmt);
            oldInv.balance_due = Math.max(0, oldInv.total - oldInv.paid_amount);
            if (oldInv.balance_due > 0 && oldInv.status === "paid") {
              oldInv.status = (oldInv.due_date && new Date(oldInv.due_date) < new Date()) ? "overdue" : "sent";
            }
            await oldInv.save();
          }
        }

        const newStatus = req.body.status || oldPayment.status;
        const newInvoiceId = req.body.invoice_id || oldPayment.invoice_id;
        const newAmt = Number(req.body.amount !== undefined ? req.body.amount : oldPayment.amount) || 0;

        if (newStatus === "success" && newInvoiceId) {
          const newInv = await Invoice.findOne({ _id: newInvoiceId, created_by: req.user.email });
          if (newInv) {
            newInv.paid_amount += newAmt;
            newInv.balance_due = Math.max(0, newInv.total - newInv.paid_amount);
            if (newInv.balance_due <= 0 && newInv.status !== "cancelled") {
              newInv.status = "paid";
            }
            await newInv.save();
          }
        }
      }
    }

    const item = await Model.findOneAndUpdate(query, req.body, {
      new: true,
      runValidators: true
    });

    if (!item) {
      return res.status(404).json({ error: `${Model.modelName} not found or unauthorized` });
    }

    res.json(item);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteEntity = async (req, res) => {
  const { entityName, id } = req.params;

  const Model = getModel(entityName);
  if (!Model) {
    return res.status(400).json({ error: `Invalid entity: ${entityName}` });
  }

  if (id === "all") {
    try {
      let query = {};
      if (Model.modelName !== "User") {
        query.created_by = req.user.email;
      } else {
        return res.status(403).json({ error: "Access denied" });
      }
      await Model.deleteMany(query);
      return res.json({ success: true, message: `All ${Model.modelName}s deleted successfully` });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  try {
    let query = { _id: id };
    if (Model.modelName !== "User") {
      query.created_by = req.user.email;
    } else if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    // 1. Revert inventory stock adjustments on active Sales Invoice deletion
    if (Model.modelName === "Invoice") {
      const oldInv = await Invoice.findOne(query);
      if (oldInv) {
        const oldStatus = oldInv.status;
        const oldActive = oldStatus && oldStatus !== "draft" && oldStatus !== "cancelled";
        if (oldActive && oldInv.items) {
          await adjustInventoryStock(oldInv.items, 1, false);
        }
      }
    }

    // 2. Revert invoice paid balances on Payment deletion
    if (Model.modelName === "Payment") {
      const oldPayment = await Payment.findOne(query);
      if (oldPayment && oldPayment.status === "success" && oldPayment.invoice_id) {
        const inv = await Invoice.findOne({ _id: oldPayment.invoice_id, created_by: req.user.email });
        if (inv) {
          const amount = Number(oldPayment.amount) || 0;
          inv.paid_amount = Math.max(0, inv.paid_amount - amount);
          inv.balance_due = Math.max(0, inv.total - inv.paid_amount);
          if (inv.balance_due > 0 && inv.status === "paid") {
            inv.status = (inv.due_date && new Date(inv.due_date) < new Date()) ? "overdue" : "sent";
          }
          await inv.save();
        }
      }
    }

    const item = await Model.findOneAndDelete(query);
    if (!item) {
      return res.status(404).json({ error: `${Model.modelName} not found or unauthorized` });
    }

    res.json({ success: true, message: `${Model.modelName} deleted successfully` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
