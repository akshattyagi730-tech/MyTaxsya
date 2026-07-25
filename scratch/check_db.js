import mongoose from 'mongoose';
import User from '../backend/models/User.js';
import Invoice from '../backend/models/Invoice.js';
import Customer from '../backend/models/Customer.js';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/gst-ai";

async function check() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB.");

    const users = await User.find({});
    console.log(`\n--- USERS (${users.length}) ---`);
    users.forEach(u => {
      console.log(`- Email: ${u.email}, Role: ${u.role}, CreatedAt: ${u.createdAt}`);
    });

    const customers = await Customer.find({});
    console.log(`\n--- CUSTOMERS (${customers.length}) ---`);
    customers.forEach(c => {
      console.log(`- Name: ${c.name}, Status: ${c.status}, CreatedBy: ${c.created_by}`);
    });

    const invoices = await Invoice.find({});
    console.log(`\n--- INVOICES (${invoices.length}) ---`);
    invoices.forEach(inv => {
      console.log(`- Invoice #: ${inv.invoice_number}, Customer: ${inv.customer_name}, Total: ${inv.total}, Date: ${inv.invoice_date}, Status: ${inv.status}, CreatedBy: ${inv.created_by}`);
    });

  } catch (err) {
    console.error("Error checking db:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB.");
  }
}

check();
