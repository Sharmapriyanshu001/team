// Creates (or upgrades) the admin account.
// Run with:  node seedAdmin.js
// Override defaults with:  ADMIN_EMAIL=x@y.com ADMIN_PASSWORD=secret node seedAdmin.js

import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "./models/User.js";
import { hashPassword } from "./utils/password.js";

dotenv.config();

const NAME = process.env.ADMIN_NAME || "Abhay";
const EMAIL = (process.env.ADMIN_EMAIL || "abhay@gmail.com").toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD || "abhay123";

/**
 * The seeded account is a super admin: it is the one that hands out roles to
 * everybody else, so it must be the one nobody can lock out. Set
 * ADMIN_ROLE=admin to seed a plain admin instead.
 */
const ROLE = process.env.ADMIN_ROLE === "admin" ? "admin" : "super_admin";

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    const existing = await User.findOne({ email: EMAIL });

    if (existing) {
      existing.name = NAME;
      existing.role = ROLE;
      existing.password = hashPassword(PASSWORD);
      await existing.save();
      console.log(`♻️  Existing account updated to ${ROLE}: ${EMAIL}`);
    } else {
      await User.create({
        name: NAME,
        email: EMAIL,
        password: hashPassword(PASSWORD),
        role: ROLE,
      });
      console.log(`✅ ${ROLE} created: ${EMAIL}`);
    }

    console.log(`   Password: ${PASSWORD}`);
  } catch (err) {
    console.error("❌ seedAdmin error:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
