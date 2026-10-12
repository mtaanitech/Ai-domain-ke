const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable.");
  process.exit(1);
}

if (!ADMIN_KEY || ADMIN_KEY.length < 24) {
  console.error("ADMIN_KEY must contain at least 24 characters.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

function isValidDomain(domain) {
  if (typeof domain !== "string") return false;

  const value = domain.trim().toLowerCase();

  if (value.length > 253 || value.length < 4) return false;

  const labels = value.split(".");

  if (labels.length < 2) return false;

  return labels.every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

function requireAdmin(req, res, next) {
  const suppliedKey = req.get("x-admin-key") || "";

  const expected = Buffer.from(ADMIN_KEY);
  const supplied = Buffer.from(suppliedKey);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  next();
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "connected"
    });
  } catch (error) {
    console.error("Database health check failed.");

    res.status(503).json({
      ok: false,
      database: "unavailable"
    });
  }
});

app.get("/api/check", async (req, res) => {
  const domain = String(req.query.domain || "")
    .trim()
    .toLowerCase();

  if (!isValidDomain(domain)) {
    return res.status(400).json({
      ok: false,
      error: "Enter a valid domain name, e.g. example.com"
    });
  }

  try {
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM public.domains
         WHERE domain_lower = $1
       ) AS registered`,
      [domain]
    );

    const registered = result.rows[0].registered;

    res.json({
      ok: true,
      domain,
      registered,
      availableInThisSystem: !registered,
      note: "This checks this system's database, not public domain registration."
    });
  } catch (error) {
    console.error("Domain lookup failed.");

    res.status(500).json({
      ok: false,
      error: "Could not check domain right now."
    });
  }
});

app.post("/api/register", requireAdmin, async (req, res) => {
  const domain = String(req.body.domain || "")
    .trim()
    .toLowerCase();

  const owner = String(req.body.owner || "").trim();

  if (!isValidDomain(domain)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid domain name."
    });
  }

  if (!owner || owner.length > 120) {
    return res.status(400).json({
      ok: false,
      error: "Owner is required and must be at most 120 characters."
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO public.domains (domain, owner)
       VALUES ($1, $2)
       ON CONFLICT (domain_lower) DO NOTHING
       RETURNING id, domain, owner, created_at`,
      [domain, owner]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        ok: false,
        error: "This domain already exists in this system."
      });
    }

    res.status(201).json({
      ok: true,
      message: "Domain record created.",
      domain: result.rows[0]
    });
  } catch (error) {
    console.error("Domain registration failed.");

    res.status(500).json({
      ok: false,
      error: "Could not save domain."
    });
  }
});

app.get("/api/domains", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, domain, owner, created_at
       FROM public.domains
       ORDER BY created_at DESC
       LIMIT 100`
    );

    res.json({
      ok: true,
      count: result.rowCount,
      domains: result.rows
    });
  } catch (error) {
    console.error("Could not list domain records.");

    res.status(500).json({
      ok: false,
      error: "Could not retrieve records."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found."
  });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Mtaani AI API listening on port ${PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
