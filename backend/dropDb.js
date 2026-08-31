// Drops ONE database to free up collection space on the cluster.
// Usage:  node dropDb.js <databaseName>
// Example: node dropDb.js joke
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const target = process.argv[2];

const run = async () => {
  if (!target) {
    console.error("❌ Give a database name:  node dropDb.js <databaseName>");
    process.exit(1);
  }
  if (target === "appcric") {
    console.error("❌ Refusing to drop your own app database.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const conn = mongoose.connection.useDb(target);
  const cols = await conn.db.listCollections().toArray();

  console.log(`Dropping "${target}" (${cols.length} collections)...`);
  await conn.db.dropDatabase();
  console.log(`✅ Dropped "${target}". Freed ${cols.length} collections.`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
