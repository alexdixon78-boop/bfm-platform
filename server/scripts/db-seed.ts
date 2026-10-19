import "dotenv/config";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for db:seed");
  }
  const { seedDatabase } = await import("../seed");
  const { pool } = await import("../db");
  try {
    await seedDatabase();
    console.log("Database seed completed");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Database seed failed", err);
  process.exit(1);
});
