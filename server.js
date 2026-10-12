// server.js - FIXED REAL GLOBAL - NO 403 BUG
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

let logs = [];
let jobs = {};
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

app.get("/api/logs", (req,res)=> res.json({ logs: logs.slice(-50), jobs }));
app.get("/api/logs/stream", (req,res)=>{
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  const interval = setInterval(()=>{
    res.write(`data: ${JSON.stringify({ logs: logs.slice(-30), jobs })}\n\n`);
  }, 1000);
  req.on('close',()=>clearInterval(interval));
});

app.get("/api/health",(req,res)=>{
  res.json({ok:true, mode:"REAL FIXED NO-403", tlds:ALLOWED_TLDS});
});

// === FIXED CHECK FUNCTION ===
async function realCheck(domain){
  const tld = domain.split('.').pop();
  const isCoKe = domain.endsWith('.co.ke');

  let urls = [];
  if(isCoKe) urls.push(`https://rdap.kenic.or.ke/rdap/domain/${domain}`);
  if(tld==='com' || tld==='net') urls.push(`https://rdap.verisign.com/com/v1/domain/${domain}`);
  else if(tld==='org') urls.push(`https://rdap.publicinterestregistry.net/rdap/domain/${domain}`);
  urls.push(`https://rdap.org/domain/${domain}`); // last try

  for(const url of urls){
    try{
      addLog(`Trying ${url}`,"info");
      const r = await fetch(url, { headers: { 'Accept':'application/json' }, signal: AbortSignal.timeout(8000) });
      addLog(`RDAP response for ${domain}: ${r.status} from ${new URL(url).hostname}`,"info");
      if(r.status===404) return { available: true };
      if(r.status===200) return { available: false };
      if(r.status===403 || r.status===429) continue; // try next
    }catch(e){
      addLog(`Fail ${url}: ${e.message}`,"error");
      continue;
    }
  }

  // FINAL FALLBACK: Cloudflare DNS - if no A record = likely FREE
  try{
    const dns = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, { headers: { accept: 'application/dns-json' } });
    const j = await dns.json();
    if(!j.Answer || j.Answer.length===0){
      addLog(`Fallback DNS: ${domain} has NO record => AVAILABLE`,"success");
      return { available: true, fallback: true };
    } else {
      addLog(`Fallback DNS: ${domain} HAS record => TAKEN`,"error");
      return { available: false, fallback: true };
    }
  }catch(e){
    return { available: false, error: e.message };
  }
}

app.get("/api/check", async (req,res)=>{
  const domain=(req.query.domain||"").toLowerCase().trim();
  if(!isValidDomain(domain)) return res.status(400).json({error:`Use: ${ALLOWED_TLDS.join(", ")}`});

  const jobId = `check_${Date.now()}`;
  jobs[jobId]={domain,status:"checking",start:new Date().toISOString()};
  addLog(`START checking ${domain} worldwide via REAL RDAP...`,"check");

  const result = await realCheck(domain);
  jobs[jobId].status = result.available? "available" : "taken";
  addLog(`${domain} is ${result.available? 'AVAILABLE ✅' : 'TAKEN ❌'}`,"info");
  res.json({domain, available: result.available, jobId,...result});
});

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
  addLog(`Server started on ${PORT} - FIXED REAL GLOBAL NO 403 BUG`,"success");
});
