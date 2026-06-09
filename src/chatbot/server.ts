import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { PROVIDERS, ALL_PROVIDERS } from "./providers";
import type { ChatRequest, ProviderInfo } from "./types";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

// ─── HTML UI ──────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free LLM Chatbot</title>
<style>
:root{--bg:#0d0d14;--surf:#16161f;--surf2:#1e1e2a;--brd:#2a2a3a;--acc:#7c6ef9;--acc2:#4a43a0;--txt:#e2e2f0;--dim:#8888aa;--ubub:#2a2760;--abub:#1a1a28;--ok:#4ade80;--warn:#fb923c;--err:#f87171}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--txt);height:100vh;display:flex;flex-direction:column;overflow:hidden}
header{background:var(--surf);border-bottom:1px solid var(--brd);padding:12px 20px;display:flex;align-items:center;gap:14px;flex-shrink:0}
header h1{font-size:17px;font-weight:700;letter-spacing:-.01em}
.badge{background:var(--acc2);color:var(--txt);padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600}
.main{display:flex;flex:1;overflow:hidden}
.sidebar{width:290px;background:var(--surf);border-right:1px solid var(--brd);display:flex;flex-direction:column;overflow-y:auto;padding:14px;gap:14px;flex-shrink:0}
.sec{display:flex;flex-direction:column;gap:6px}
.lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
select,input[type=text],input[type=password],input[type=number]{background:var(--bg);border:1px solid var(--brd);color:var(--txt);padding:8px 10px;border-radius:7px;font-size:13px;width:100%;outline:none;transition:border .15s}
select:focus,input:focus{border-color:var(--acc)}
.hint{font-size:10px;color:var(--dim);margin-top:-2px}
.info-card{background:var(--bg);border:1px solid var(--brd);border-radius:8px;padding:10px;font-size:11px;color:var(--dim);display:flex;flex-direction:column;gap:5px}
.info-row{display:flex;gap:6px}
.info-lbl{font-weight:700;color:var(--txt);min-width:60px;flex-shrink:0}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;flex-shrink:0}
.dot.ok{background:var(--ok)}.dot.miss{background:var(--warn)}
input[type=range]{-webkit-appearance:none;width:100%;height:3px;background:var(--brd);border-radius:2px;outline:none;padding:0;border:none}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--acc);cursor:pointer}
.row{display:flex;justify-content:space-between;align-items:center}
.val{font-size:11px;color:var(--dim)}
.clear-btn{background:transparent;color:var(--dim);border:1px solid var(--brd);padding:7px 14px;border-radius:7px;cursor:pointer;font-size:12px;transition:all .15s}
.clear-btn:hover{border-color:var(--dim);color:var(--txt)}
.chat{flex:1;display:flex;flex-direction:column;overflow:hidden}
.msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px}
.msg{display:flex;flex-direction:column;gap:5px;max-width:82%}
.msg.user{align-self:flex-end;align-items:flex-end}
.msg.assistant{align-self:flex-start}
.bubble{padding:11px 15px;border-radius:14px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.user .bubble{background:var(--ubub);border-bottom-right-radius:3px}
.assistant .bubble{background:var(--abub);border:1px solid var(--brd);border-bottom-left-radius:3px}
.meta{font-size:10px;color:var(--dim);display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.tag{background:var(--acc2);color:var(--txt);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700}
.inp{padding:14px 18px;border-top:1px solid var(--brd);background:var(--surf);flex-shrink:0}
.form{display:flex;gap:10px;align-items:flex-end}
.inp-wrap{flex:1}
textarea{width:100%;background:var(--bg);border:1px solid var(--brd);color:var(--txt);padding:11px 14px;border-radius:11px;font-size:14px;resize:none;outline:none;font-family:inherit;line-height:1.5;min-height:44px;max-height:180px;transition:border .15s}
textarea:focus{border-color:var(--acc)}
.send{background:var(--acc);color:#fff;border:none;padding:11px 18px;border-radius:11px;cursor:pointer;font-size:14px;font-weight:600;height:44px;transition:background .15s}
.send:hover{background:var(--acc2)}.send:disabled{opacity:.45;cursor:not-allowed}
.typing{display:flex;gap:4px;padding:11px 15px;align-items:center}
.tdot{width:5px;height:5px;border-radius:50%;background:var(--dim);animation:b 1.2s ease-in-out infinite}
.tdot:nth-child(2){animation-delay:.2s}.tdot:nth-child(3){animation-delay:.4s}
@keyframes b{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-7px)}}
.err{background:#1f1010;border:1px solid var(--err);border-radius:8px;padding:10px 14px;color:var(--err);font-size:13px}
.welcome{text-align:center;padding:48px 20px;color:var(--dim);max-width:600px;margin:auto}
.welcome h2{font-size:22px;margin-bottom:8px;color:var(--txt)}
.welcome p{font-size:13px;line-height:1.6}
.chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:7px;margin-top:20px}
.chip{background:var(--surf);border:1px solid var(--brd);border-radius:7px;padding:7px 10px;font-size:11px;display:flex;align-items:center;gap:5px;cursor:pointer;transition:border .15s}
.chip:hover{border-color:var(--acc)}
</style>
</head>
<body>
<header>
  <h1>&#129302; Free LLM Chatbot</h1>
  <span class="badge" id="badge">Loading...</span>
</header>
<div class="main">
  <aside class="sidebar">
    <div class="sec">
      <span class="lbl">Provider</span>
      <select id="prov"></select>
    </div>
    <div class="sec">
      <span class="lbl">Model</span>
      <select id="model"></select>
    </div>
    <div class="sec" id="key-sec">
      <span class="lbl" id="key-lbl">API Key</span>
      <input type="password" id="key" placeholder="Paste your API key...">
      <span class="hint">Stored in your browser only</span>
    </div>
    <div class="sec" id="extra-sec" style="display:none">
      <span class="lbl" id="extra-lbl">Account ID</span>
      <input type="text" id="extra" placeholder="">
    </div>
    <div class="sec" id="info-sec" style="display:none">
      <span class="lbl">Info</span>
      <div class="info-card">
        <div class="info-row"><span class="info-lbl">Limits</span><span id="info-limits"></span></div>
        <div class="info-row"><span class="info-lbl">Notes</span><span id="info-notes"></span></div>
        <a id="info-link" href="#" target="_blank" style="color:var(--acc);font-size:10px;margin-top:2px">Sign up &#8599;</a>
      </div>
    </div>
    <div class="sec">
      <span class="lbl">Temperature</span>
      <div class="row">
        <input type="range" id="temp" min="0" max="2" step="0.1" value="0.7">
        <span class="val" id="tv">0.7</span>
      </div>
    </div>
    <div class="sec">
      <span class="lbl">Max Tokens</span>
      <input type="number" id="mtok" value="1024" min="64" max="8192">
    </div>
    <button class="clear-btn" onclick="clearChat()">Clear chat</button>
  </aside>
  <main class="chat">
    <div class="msgs" id="msgs">
      <div class="welcome" id="welcome">
        <h2>Free LLM Chatbot</h2>
        <p>Chat with 10+ free AI providers — no backend required.<br>Select a provider from the sidebar, enter your API key, and start chatting.</p>
        <div class="chips" id="chips"></div>
      </div>
    </div>
    <div class="inp">
      <div class="form">
        <div class="inp-wrap"><textarea id="tinp" placeholder="Type a message... (Enter to send, Shift+Enter for newline)" rows="1"></textarea></div>
        <button class="send" id="sbtn" onclick="send()">Send</button>
      </div>
    </div>
  </main>
</div>

<script>
var providers={}, msgs=[], loading=false;

function sk(id){return localStorage.getItem('k_'+id)||''}
function sv(id,v){if(v)localStorage.setItem('k_'+id,v);else localStorage.removeItem('k_'+id)}
function se(id){try{return JSON.parse(localStorage.getItem('e_'+id)||'{}')}catch{return{}}}
function sve(id,o){localStorage.setItem('e_'+id,JSON.stringify(o))}

async function init(){
  const r=await fetch('/api/providers');
  const ps=await r.json();
  providers={};
  ps.forEach(p=>{providers[p.id]=p});

  const sel=document.getElementById('prov');
  sel.innerHTML='<option value="">-- Select provider --</option>';
  ps.forEach(p=>{
    const o=document.createElement('option');
    o.value=p.id; o.textContent=p.name;
    sel.appendChild(o);
  });

  document.getElementById('badge').textContent=ps.length+' providers';

  const chips=document.getElementById('chips');
  ps.forEach(p=>{
    const c=document.createElement('div');
    c.className='chip'; c.id='chip_'+p.id;
    const hasKey=sk(p.id)||p.hasServerKey;
    c.innerHTML='<span class="dot '+(hasKey?'ok':'miss')+'"></span>'+p.name;
    c.onclick=()=>{document.getElementById('prov').value=p.id;onProv()};
    chips.appendChild(c);
  });
}

function onProv(){
  const id=document.getElementById('prov').value;
  if(!id)return;
  const p=providers[id];

  const ms=document.getElementById('model');
  ms.innerHTML='';
  p.models.forEach(m=>{
    const o=document.createElement('option');
    o.value=m.id;
    o.textContent=m.name+(m.notes?' ('+m.notes+')':'');
    ms.appendChild(o);
  });

  const keyField=document.getElementById('key');
  keyField.value=sk(id);

  if(p.hasServerKey&&!sk(id)){
    document.getElementById('key-lbl').textContent='API Key (env var configured)';
    keyField.placeholder='Using server env var (optional override)';
  } else {
    document.getElementById('key-lbl').textContent='API Key';
    keyField.placeholder='Paste your API key...';
  }

  const extraSec=document.getElementById('extra-sec');
  if(p.extraConfig){
    extraSec.style.display='flex'; extraSec.style.flexDirection='column'; extraSec.style.gap='6px';
    document.getElementById('extra-lbl').textContent=p.extraConfig.label;
    document.getElementById('extra').placeholder=p.extraConfig.placeholder||p.extraConfig.label;
    const stored=se(id);
    document.getElementById('extra').value=stored[p.extraConfig.key]||'';
  } else {
    extraSec.style.display='none';
  }

  document.getElementById('info-sec').style.display='block';
  document.getElementById('info-limits').textContent=p.rateLimits;
  document.getElementById('info-notes').textContent=p.notes;
  document.getElementById('info-link').href=p.homepage;
}

function onKey(){
  const id=document.getElementById('prov').value; if(!id)return;
  const v=document.getElementById('key').value;
  sv(id,v);
  const c=document.getElementById('chip_'+id);
  if(c){const d=c.querySelector('.dot'); if(d)d.className='dot '+(v||providers[id]?.hasServerKey?'ok':'miss')}
}

function onExtra(){
  const id=document.getElementById('prov').value; if(!id)return;
  const p=providers[id]; if(!p?.extraConfig)return;
  sve(id,{[p.extraConfig.key]:document.getElementById('extra').value});
}

document.getElementById('prov').addEventListener('change',onProv);
document.getElementById('key').addEventListener('input',onKey);
document.getElementById('extra').addEventListener('input',onExtra);
document.getElementById('temp').addEventListener('input',function(){document.getElementById('tv').textContent=this.value});

const ta=document.getElementById('tinp');
ta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,180)+'px'});
ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});

function appendMsg(role,html,meta){
  const w=document.getElementById('welcome');
  if(w)w.remove();
  const c=document.getElementById('msgs');
  const d=document.createElement('div');
  d.className='msg '+role;
  const b=document.createElement('div');
  b.className='bubble'; b.innerHTML=html;
  d.appendChild(b);
  if(meta){
    const m=document.createElement('div');
    m.className='meta';
    if(meta.provider)m.innerHTML+='<span class="tag">'+esc(meta.provider)+'</span>';
    if(meta.model)m.innerHTML+='<span>'+esc(meta.model)+'</span>';
    if(meta.latency)m.innerHTML+='<span>'+meta.latency+'ms</span>';
    if(meta.tokens)m.innerHTML+='<span>'+meta.tokens+' tok</span>';
    d.appendChild(m);
  }
  c.appendChild(d);
  c.scrollTop=c.scrollHeight;
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function addLoader(){
  const w=document.getElementById('welcome'); if(w)w.remove();
  const c=document.getElementById('msgs');
  const d=document.createElement('div');
  d.id='loader'; d.className='msg assistant';
  d.innerHTML='<div class="bubble"><div class="typing"><div class="tdot"></div><div class="tdot"></div><div class="tdot"></div></div></div>';
  c.appendChild(d); c.scrollTop=c.scrollHeight;
}

function rmLoader(){const l=document.getElementById('loader');if(l)l.remove()}

async function send(){
  if(loading)return;
  const id=document.getElementById('prov').value;
  const model=document.getElementById('model').value;
  const key=document.getElementById('key').value;
  const text=ta.value.trim();
  const temp=parseFloat(document.getElementById('temp').value);
  const mtok=parseInt(document.getElementById('mtok').value);

  if(!text)return;
  if(!id){alert('Please select a provider');return}
  if(!model){alert('Please select a model');return}

  const p=providers[id];
  let extra={};
  if(p?.extraConfig){extra=se(id)}

  msgs.push({role:'user',content:text});
  appendMsg('user',esc(text).replace(/\\n/g,'<br>'));
  ta.value=''; ta.style.height='auto';

  loading=true;
  document.getElementById('sbtn').disabled=true;
  addLoader();

  try{
    const res=await fetch('/api/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({providerId:id,model,apiKey:key,messages:msgs.slice(-20),temperature:temp,maxTokens:mtok,extraConfig:extra})
    });
    const data=await res.json();
    rmLoader();
    if(data.error){
      const d=document.createElement('div');
      d.className='err'; d.textContent='Error: '+data.error;
      document.getElementById('msgs').appendChild(d);
      document.getElementById('msgs').scrollTop=9999;
      msgs.pop();
    } else {
      msgs.push({role:'assistant',content:data.content});
      appendMsg('assistant',esc(data.content).replace(/\\n/g,'<br>'),{
        provider:data.provider, model:data.model,
        latency:data.latencyMs, tokens:data.usage?.totalTokens
      });
    }
  } catch(e){
    rmLoader();
    const d=document.createElement('div');
    d.className='err'; d.textContent='Network error: '+e.message;
    document.getElementById('msgs').appendChild(d);
    document.getElementById('msgs').scrollTop=9999;
    msgs.pop();
  } finally {
    loading=false;
    document.getElementById('sbtn').disabled=false;
  }
}

function clearChat(){
  msgs=[];
  document.getElementById('msgs').innerHTML='<div class="welcome" id="welcome"><h2>Free LLM Chatbot</h2><p>Chat with 10+ free AI providers. Select a provider to begin.</p><div class="chips" id="chips"></div></div>';
  Object.values(providers).forEach(p=>{
    const c=document.createElement('div');
    c.className='chip'; c.id='chip_'+p.id;
    const hasKey=sk(p.id)||p.hasServerKey;
    c.innerHTML='<span class="dot '+(hasKey?'ok':'miss')+'"></span>'+p.name;
    c.onclick=()=>{document.getElementById('prov').value=p.id;onProv()};
    document.getElementById('chips').appendChild(c);
  });
}

init();
</script>
</body>
</html>`;

// ─── HTTP Utilities ────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

function handleProviders(res: ServerResponse): void {
  const list: ProviderInfo[] = ALL_PROVIDERS.map((p) => ({
    ...p.info,
    hasServerKey: !!process.env[p.info.envVar],
  }));
  json(res, 200, list);
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);

  let body: {
    providerId?: string;
    model?: string;
    apiKey?: string;
    messages?: unknown;
    temperature?: number;
    maxTokens?: number;
    extraConfig?: Record<string, string>;
  };

  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const { providerId, model, apiKey, messages, temperature, maxTokens, extraConfig } = body;

  if (!providerId || !model || !Array.isArray(messages)) {
    json(res, 400, { error: "providerId, model, and messages are required" });
    return;
  }

  const provider = PROVIDERS.get(providerId);
  if (!provider) {
    json(res, 400, { error: `Unknown provider: ${providerId}` });
    return;
  }

  // Prefer server-side env key over client-provided key
  const resolvedKey = process.env[provider.info.envVar] ?? apiKey ?? "";

  if (!resolvedKey) {
    json(res, 400, {
      error: `No API key for ${provider.info.name}. Set ${provider.info.envVar} or enter one in the sidebar.`,
    });
    return;
  }

  const chatReq: ChatRequest = {
    messages: messages as ChatRequest["messages"],
    model,
    apiKey: resolvedKey,
    extraConfig,
    temperature,
    maxTokens,
  };

  try {
    const result = await provider.chat(chatReq);
    json(res, 200, result);
  } catch (err) {
    json(res, 500, {
      error: err instanceof Error ? err.message : String(err),
      provider: providerId,
    });
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }

    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
      return;
    }

    if (req.method === "GET" && url === "/api/providers") {
      handleProviders(res);
      return;
    }

    if (req.method === "POST" && url === "/api/chat") {
      try {
        await handleChat(req, res);
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : "Internal server error" });
      }
      return;
    }

    json(res, 404, { error: "Not found" });
  });
}

export function startServer(): void {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`\n🤖  Free LLM Chatbot`);
    console.log(`    http://localhost:${PORT}\n`);
    console.log(`Configured providers:`);
    ALL_PROVIDERS.forEach((p) => {
      const hasKey = !!process.env[p.info.envVar];
      console.log(`  ${hasKey ? "✓" : "○"} ${p.info.name} (${p.info.envVar})`);
    });
    console.log(`\nProviders without an env key can still be used by entering a key in the UI.\n`);
  });
}
