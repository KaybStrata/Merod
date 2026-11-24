import { tickSimulated } from "@/server/market/prices";
import { pool } from "@/server/db";
console.log("ticked", await tickSimulated());
await pool.end();
