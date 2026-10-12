require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

const ROOT_HOST = process.env.ROOT_HOST || "mtaani-ai-domain.onrender.com";
const ADMIN_KEY = process.env.ADMIN_KEY || "change-this-admin-key";
const EXPORT_DIR = process.env.EXPORT_DIR || "exports";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function publicUrlFor(domain) {
  if (!domain) return null;
  const clean = String(domain).trim().toLowerCase();
  return `https://${clean}.${ROOT_HOST}`;
}

function isValidDomainName(input) {
  if (!input || typeof input !== "string") return false;
  const value = input.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(value)) return false;
  if (value.length < 3 || value.length > 63) return false;
  return true;
}

function normalizeDomain(input) {
  return String(input).trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

app.use((req, res, next) => {
  const host = req.hostname || "";
  if (host && host.endsWith(`.${ROOT_HOST}`)) {
    req.virtualDomain = host.slice(0, -(`.${ROOT_HOST}`.length + 1));
  } else {
    req.virtualDomain = null;
  }
  next();
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, status: "healthy", root_host: ROOT_HOST });
  } catch (err) {
    res.status(500).json({ ok: false, error: "db-unhealthy", detail: err.message });
  }
});

app.get("/api/check", async (req, res) => {
  const domain = normalizeDomain(req.query.domain || "");
  if (!isValidDomainName(domain)) {
    return res.status(400).json({ ok: false, error: "invalid-domain" });
  }

  try {
    const result = await pool.query(
      "SELECT id FROM domains WHERE domain_lower = $1 LIMIT 1",
      [domain]
    );

    const taken = result.rowCount > 0;
    return res.json({
      ok: true,
      domain,
      taken,
      available: !taken,
      public_url: publicUrlFor(domain),
      source: "this_system_db"
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/register", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const raw = req.body && req.body.domain ? req.body.domain : "";
  const owner = req.body && req.body.owner ? String(req.body.owner).trim() : "unknown";
  const domain = normalizeDomain(raw);

  if (!isValidDomainName(domain)) {
    return res.status(400).json({ ok: false, error: "invalid-domain" });
  }

  try {
    const exists = await pool.query(
      "SELECT id FROM domains WHERE domain_lower = $1 LIMIT 1",
      [domain]
    );

    if (exists.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        error: "domain-already-registered",
        domain,
        public_url: publicUrlFor(domain)
      });
    }

    const insert = await pool.query(
      `INSERT INTO domains (domain, domain_lower, owner, status, created_at)
       VALUES ($1, $2, $3, 'active', NOW())
       RETURNING *`,
      [domain, domain, owner]
    );

    const row = insert.rows[0];
    return res.status(201).json({
      ok: true,
      message: "Domain registered",
      domain: row,
      public_url: publicUrlFor(row.domain_lower)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/domains", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const result = await pool.query(
      "SELECT id, domain, owner, status, created_at FROM domains ORDER BY id DESC LIMIT 100"
    );
    res.json({ ok: true, domains: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/generate", async (req, res) => {
  const base = (req.query.idea || "startup").toString().trim().toLowerCase();
  if (!base) {
    return res.status(400).json({ ok: false, error: "idea-required" });
  }

  const cleaned = base
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 25);

  const keywords = ["studio", "hub", "labs", "works", "co", "app", "market", "portal", "network"];
  const suggestions = [];
  const used = new Set();

  for (const kw of keywords) {
    const s = `${cleaned}-${kw}`.replace(/-+/g, "-");
    if (s && !used.has(s)) {
      used.add(s);
      suggestions.push({ domain: s, public_url: publicUrlFor(s) });
    }
  }

  return res.json({ ok: true, suggestions });
});

app.get("/", async (req, res) => {
  if (req.virtualDomain) {
    try {
      const result = await pool.query(
        "SELECT id, domain, owner, status FROM domains WHERE domain_lower = $1 LIMIT 1",
        [req.virtualDomain]
      );

      if (result.rowCount === 0) {
        return res.status(404).send("Domain not found");
      }

      const domain = result.rows[0];
      return res.send(`
        <html>
          <head><title>${domain.domain}</title></head>
          <body>
            <h1>${domain.domain}</h1>
            <p>Owner: ${domain.owner}</p>
            <p>Status: ${domain.status}</p>
          </body>
        </html>
      `);
    } catch (err) {
      return res.status(500).send("Error resolving domain");
    }
  }

  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not-found" });
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS domains (
        id SERIAL PRIMARY KEY,
        domain TEXT NOT NULL UNIQUE,
        domain_lower TEXT NOT NULL UNIQUE,
        owner TEXT,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_domains_domain_lower
      ON domains(domain_lower);
    `);

    console.log("Database initialized");
  } catch (err) {
    console.error("DB init failed:", err.message);
    process.exit(1);
  }
}

(async () => {
  await initDb();
  app.listen(port, () => {
    console.log(`App listening on http://localhost:${port}`);
  });
})();
