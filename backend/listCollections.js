// Diagnostic: shows every database on the cluster and how many collections each has.
// Run:  node listCollections.js
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const admin = mongoose.connection.db.admin();
  const { databases } = await admin.listDatabases();

  console.log("\n=== Databases on this cluster ===");
  let total = 0;
  for (const db of databases) {
    const conn = mongoose.connection.useDb(db.name);
    const cols = await conn.db.listCollections().toArray();
    total += cols.length;
    console.log(
      `${db.name.padEnd(25)} -> ${cols.length} collections` +
        (cols.length ? `  [${cols.map((c) => c.name).join(", ")}]` : "")
    );
  }
  console.log(`\nTOTAL collections on cluster: ${total} / 500 (free tier limit)\n`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
