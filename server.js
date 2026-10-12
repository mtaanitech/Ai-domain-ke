// server.js - REAL GLOBAL + CLONE + LIVE TAIL
import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- LIVE TAIL SYSTEM ---
let logs = [];
let jobs = {}; // jobId -> status

function addLog(msg, type="info"){
  const entry = { time: new Date().toISOString(), msg, type };
  logs.push(entry);
  if(logs.length>200) logs.shift();
  console.log(`[${type}] ${msg}`);
}

const pool = process.env.DATABASE_URL? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:{rejectUnauthorized:false}
}): null;

const ALLOWED_TLDS = [".com",".co.ke",".ke",".net",".org",".app",".store",".xyz"];
const isValidDomain = d=>ALLOWED_TLDS.some(t=>d.endsWith(t)) && /^[a-z0-9-]+\.[a-z.]+$/.test(d);

// 1. LIVE TAIL ENDPOINT - for frontend
app.get("/api/logs", (req,res)=>{
  res.json({ logs: logs.slice(-50), jobs });
});

// SSE LIVE TAIL - real time stream
app.get("/api/logs/stream", (req,res)=>{
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  const interval = setInterval(()=>{
    res.write(`data: ${JSON.stringify({ logs: logs.slice(-30), jobs })}\n\n`);
  }, 1000);
  req.on('close',()=>clearInterval(interval));
});

// 2. HEALTH + BACKGROUND STATUS
app.get("/api/health",(req,res)=>{
  addLog("Health check","info");
  res.json({ok:true, mode:"REAL+CLONE+LIVE_TAIL", tlds:ALLOWED_TLDS, jobs_count:Object.keys(jobs).length});
});

// 3. REAL CHECK WITH BACKGROUND LOGS
app.get("/api/check", async (req,res)=>{
  const domain=(req.query.domain||"").toLowerCase().trim();
  if(!isValidDomain(domain)) return res.status(400).json({error:`Use: ${ALLOWED_TLDS.join(", ")}`});

  const jobId = `check_${Date.now()}`;
  jobs[jobId]={domain,status:"checking",start:new Date().toISOString()};
  addLog(`START checking ${domain} worldwide via RDAP...`,"check");

  try{
    const r=await fetch(`https://rdap.org/domain/${domain}`,{signal:AbortSignal.timeout(8000)});
    addLog(`RDAP response for ${domain}: ${r.status}`,"info");

    if(r.status===404){
      jobs[jobId].status="available";
      addLog(`${domain} is AVAILABLE ✅`,"success");
      return res.json({domain,available:true, jobId});
    }
    if(r.status===200){
      jobs[jobId].status="taken";
      addLog(`${domain} is TAKEN ❌`,"error");
      return res.json({domain,available:false, jobId});
    }
    jobs[jobId].status="unknown";
    return res.json({domain,available:false,jobId});
  }catch(e){
    addLog(`RDAP error for ${domain}: ${e.message}`,"error");
    jobs[jobId].status="error";
    return res.status(500).json({error:e.message, jobId});
  }
});

// 4. CLONE WITH BACKGROUND
app.post("/api/clone", async (req,res)=>{
  const {repoUrl}=req.body;
  const jobId=`clone_${Date.now()}`;
  jobs[jobId]={repoUrl,status:"cloning",start:new Date().toISOString()};
  addLog(`START cloning ${repoUrl}`,"clone");

  try{
    const match=repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if(!match) throw new Error("Invalid github url");
    const user=match[1], repo=match[2].replace(".git","");

    addLog(`Fetching GitHub API for ${user}/${repo}...`,"info");
    const apiRes=await fetch(`https://api.github.com/repos/${user}/${repo}`);
    const info=await apiRes.json();
    addLog(`Found repo: ${info.full_name} - ${info.stargazers_count} stars`,"success");

    let pkg={};
    try{
      addLog(`Checking package.json...`,"info");
      const pkgRes=await fetch(`https://raw.githubusercontent.com/${user}/${repo}/main/package.json`);
      if(pkgRes.ok){ pkg=await pkgRes.json(); addLog(`package.json found: ${pkg.name}`,"success"); }
    }catch{}

    const base=(info.name||repo).toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,12);
    let domains=[`${base}.com`,`${base}app.com`,`${base}.app`,`${base}.co.ke`,`${base}hub.com`];

    jobs[jobId].status="done";
    addLog(`CLONE done - suggested ${domains.length} domains for ${base}`,"success");

    res.json({ok:true,jobId,cloned:{user,repo,description:info.description,stars:info.stargazers_count},suggested_domains:domains});

  }catch(e){
    jobs[jobId].status="error";
    addLog(`Clone failed: ${e.message}`,"error");
    res.status(500).json({error:e.message,jobId});
  }
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const PORT=process.env.PORT||10000;
app.listen(PORT,()=>{
  addLog(`Server started on ${PORT} - REAL GLOBAL + LIVE TAIL active`,"success");
});
