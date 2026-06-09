import http from "http";
import os from "os";
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
.chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden}
/* ── Tabs ── */
.tabs{display:flex;border-bottom:1px solid var(--brd);background:var(--surf);flex-shrink:0}
.tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);padding:11px 20px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;flex-shrink:0}
.tab.active{color:var(--txt);border-bottom-color:var(--acc)}
.tab:hover:not(.active){color:var(--txt)}
/* ── Chat section ── */
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
/* ── Council sidebar ── */
.member-row{display:flex;gap:5px;align-items:center}
.member-row select{flex:1;min-width:0;font-size:11px;padding:5px 6px}
.rm-btn{background:transparent;border:1px solid var(--brd);color:var(--dim);border-radius:6px;padding:5px 8px;cursor:pointer;font-size:11px;flex-shrink:0;transition:all .15s;line-height:1}
.rm-btn:hover{border-color:var(--err);color:var(--err)}
.add-btn{background:transparent;border:1px dashed var(--brd);color:var(--dim);border-radius:7px;padding:7px;cursor:pointer;font-size:12px;width:100%;transition:all .15s;text-align:center}
.add-btn:hover{border-color:var(--acc);color:var(--acc)}
.add-btn:disabled{opacity:.4;cursor:not-allowed}
.no-key{font-size:9px;color:var(--warn);margin-left:2px}
/* ── Council main ── */
.council-section{flex:1;display:flex;flex-direction:column;overflow:hidden}
.c-scroll{flex:1;overflow-y:auto}
.c-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 20px;text-align:center;color:var(--dim);min-height:200px}
.c-empty h3{font-size:18px;color:var(--txt);margin-bottom:8px}
.c-empty p{font-size:13px;line-height:1.6;max-width:340px}
.prompt-hdr{padding:14px 20px;border-bottom:1px solid var(--brd);background:var(--surf2);flex-shrink:0}
.prompt-lbl{font-size:10px;color:var(--dim);text-transform:uppercase;font-weight:700;letter-spacing:.06em;margin-bottom:4px}
.prompt-txt{font-size:14px;color:var(--txt);line-height:1.5;white-space:pre-wrap;word-break:break-word}
.phase-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);padding:16px 20px 8px;display:flex;align-items:center;gap:10px}
.phase-hdr::after{content:'';flex:1;height:1px;background:var(--brd)}
.council-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;padding:0 20px 16px}
.a-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;transition:border-color .2s,box-shadow .2s}
.a-card.winner{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc)}
.a-hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.a-prov{font-size:10px;color:var(--dim)}
.a-model{font-size:11px;font-weight:700;color:var(--acc);word-break:break-all;line-height:1.3}
.a-votes{text-align:right;flex-shrink:0}
.a-vcount{font-size:22px;font-weight:800;color:var(--acc);line-height:1}
.a-vlbl{font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}
.a-body{font-size:12px;line-height:1.6;color:var(--txt);overflow-y:auto;max-height:160px;white-space:pre-wrap;word-break:break-word}
.a-latency{font-size:10px;color:var(--dim)}
.w-banner{background:var(--acc);color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;display:inline-block}
.vote-lines{padding:0 20px 16px;display:flex;flex-direction:column;gap:4px}
.v-line{font-size:12px;display:flex;gap:7px;align-items:baseline;flex-wrap:wrap;padding:5px 0;border-bottom:1px solid var(--brd)}
.v-line:last-child{border-bottom:none}
.v-voter{color:var(--acc);font-weight:700;flex-shrink:0}
.v-for{color:var(--dim);flex-shrink:0}
.v-reason{color:var(--txt);font-style:italic}
.v-err{color:var(--err);font-size:11px}
.winner-card{margin:0 20px 20px;background:linear-gradient(135deg,var(--acc2),#261a6e);border-radius:10px;padding:14px;display:flex;gap:12px;align-items:center}
.winner-icon{font-size:28px;flex-shrink:0;line-height:1}
.c-loader{display:flex;align-items:center;gap:10px;padding:16px 20px;font-size:12px;color:var(--dim)}
.c-send{background:var(--acc);color:#fff;border:none;padding:11px 18px;border-radius:11px;cursor:pointer;font-size:14px;font-weight:600;height:44px;transition:background .15s;flex-shrink:0}
.c-send:hover{background:var(--acc2)}.c-send:disabled{opacity:.45;cursor:not-allowed}
</style>
</head>
<body>
<header>
  <h1>&#129302; Free LLM Chatbot</h1>
  <span class="badge" id="badge">Loading...</span>
</header>
<div class="main">
  <aside class="sidebar">
    <!-- Chat sidebar (hidden in council mode) -->
    <div id="chat-sidebar" style="display:contents">
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
    </div>
    <!-- Council sidebar (hidden in chat mode) -->
    <div id="c-sidebar" style="display:none">
      <div class="sec">
        <span class="lbl">Council Members <span id="c-count" style="font-weight:400;color:var(--dim)">(0/5)</span></span>
        <div id="c-members" style="display:flex;flex-direction:column;gap:7px"></div>
        <button class="add-btn" id="c-add-btn" onclick="addMember()">+ Add Member</button>
        <span class="hint">API keys are shared from the Chat tab</span>
      </div>
      <div class="sec">
        <span class="lbl">Temperature</span>
        <div class="row">
          <input type="range" id="c-temp" min="0" max="2" step="0.1" value="0.7">
          <span class="val" id="c-tv">0.7</span>
        </div>
      </div>
      <div class="sec">
        <span class="lbl">Tokens / Member</span>
        <input type="number" id="c-mtok" value="512" min="64" max="4096">
      </div>
    </div>
    <button class="clear-btn" id="clear-btn" onclick="doClear()">Clear chat</button>
  </aside>

  <main class="chat-main">
    <!-- Mode tabs -->
    <div class="tabs">
      <button class="tab active" id="tab-chat" onclick="setMode('chat')">Chat</button>
      <button class="tab" id="tab-council" onclick="setMode('council')">&#9878; Council</button>
    </div>

    <!-- Chat section -->
    <div id="s-chat" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
      <div class="msgs" id="msgs">
        <div class="welcome" id="welcome">
          <h2>Free LLM Chatbot</h2>
          <p>Chat with 10+ free AI providers &#8212; no backend required.<br>Select a provider from the sidebar, enter your API key, and start chatting.</p>
          <div class="chips" id="chips"></div>
        </div>
      </div>
      <div class="inp">
        <div class="form">
          <div class="inp-wrap"><textarea id="tinp" placeholder="Type a message... (Enter to send, Shift+Enter for newline)" rows="1"></textarea></div>
          <button class="send" id="sbtn" onclick="send()">Send</button>
        </div>
      </div>
    </div>

    <!-- Council section -->
    <div id="s-council" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="c-scroll" id="c-scroll">
        <div class="c-empty" id="c-empty">
          <h3>&#9878; Council Mode</h3>
          <p>Add 2&#8211;5 members in the sidebar using any providers, then enter a prompt. Each model answers independently, then they all vote for the best answer.</p>
        </div>
      </div>
      <div class="inp">
        <div class="form">
          <div class="inp-wrap"><textarea id="c-tinp" placeholder="Enter a prompt for the council to discuss... (Enter to send)" rows="1"></textarea></div>
          <button class="c-send" id="c-sbtn" onclick="submitCouncil()">Ask Council</button>
        </div>
      </div>
    </div>
  </main>
</div>

<script>
var providers={}, msgs=[], loading=false;
var cMembers=[], cLoading=false;

/* ── Local storage helpers ── */
function sk(id){return localStorage.getItem('k_'+id)||''}
function sv(id,v){if(v)localStorage.setItem('k_'+id,v);else localStorage.removeItem('k_'+id)}
function se(id){try{return JSON.parse(localStorage.getItem('e_'+id)||'{}')}catch{return{}}}
function sve(id,o){localStorage.setItem('e_'+id,JSON.stringify(o))}

/* ── HTML escape ── */
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

/* ── Mode switching ── */
function setMode(m){
  var isC=m==='council';
  document.getElementById('tab-chat').classList.toggle('active',!isC);
  document.getElementById('tab-council').classList.toggle('active',isC);
  document.getElementById('s-chat').style.display=isC?'none':'flex';
  document.getElementById('s-council').style.display=isC?'flex':'none';
  document.getElementById('chat-sidebar').style.display=isC?'none':'contents';
  document.getElementById('c-sidebar').style.display=isC?'contents':'none';
  document.getElementById('clear-btn').textContent=isC?'Clear council':'Clear chat';
}

function doClear(){
  if(document.getElementById('tab-council').classList.contains('active')){
    document.getElementById('c-scroll').innerHTML='<div class="c-empty" id="c-empty"><h3>&#9878; Council Mode</h3><p>Add 2&#8211;5 members in the sidebar, then enter a prompt below.</p></div>';
  } else {
    msgs=[];
    document.getElementById('msgs').innerHTML='<div class="welcome" id="welcome"><h2>Free LLM Chatbot</h2><p>Chat with 10+ free AI providers. Select a provider to begin.</p><div class="chips" id="chips"></div></div>';
    Object.values(providers).forEach(function(p){
      var c=document.createElement('div');
      c.className='chip'; c.id='chip_'+p.id;
      var hasKey=sk(p.id)||p.hasServerKey;
      c.innerHTML='<span class="dot '+(hasKey?'ok':'miss')+'"></span>'+esc(p.name);
      c.onclick=function(){document.getElementById('prov').value=p.id;onProv()};
      document.getElementById('chips').appendChild(c);
    });
  }
}

/* ── Init ── */
async function init(){
  var r=await fetch('/api/providers');
  var ps=await r.json();
  providers={};
  ps.forEach(function(p){providers[p.id]=p});

  var sel=document.getElementById('prov');
  sel.innerHTML='<option value="">-- Select provider --</option>';
  ps.forEach(function(p){
    var o=document.createElement('option');
    o.value=p.id; o.textContent=p.name;
    sel.appendChild(o);
  });

  document.getElementById('badge').textContent=ps.length+' providers';

  var chips=document.getElementById('chips');
  ps.forEach(function(p){
    var c=document.createElement('div');
    c.className='chip'; c.id='chip_'+p.id;
    var hasKey=sk(p.id)||p.hasServerKey;
    c.innerHTML='<span class="dot '+(hasKey?'ok':'miss')+'"></span>'+esc(p.name);
    c.onclick=function(){document.getElementById('prov').value=p.id;onProv()};
    chips.appendChild(c);
  });
}

function onProv(){
  var id=document.getElementById('prov').value;
  if(!id)return;
  var p=providers[id];

  var ms=document.getElementById('model');
  ms.innerHTML='';
  p.models.forEach(function(m){
    var o=document.createElement('option');
    o.value=m.id;
    o.textContent=m.name+(m.notes?' ('+m.notes+')':'');
    ms.appendChild(o);
  });

  var keyField=document.getElementById('key');
  keyField.value=sk(id);

  if(p.hasServerKey&&!sk(id)){
    document.getElementById('key-lbl').textContent='API Key (env var set)';
    keyField.placeholder='Using server env var (optional override)';
  } else {
    document.getElementById('key-lbl').textContent='API Key';
    keyField.placeholder='Paste your API key...';
  }

  var extraSec=document.getElementById('extra-sec');
  if(p.extraConfig){
    extraSec.style.display='flex'; extraSec.style.flexDirection='column'; extraSec.style.gap='6px';
    document.getElementById('extra-lbl').textContent=p.extraConfig.label;
    document.getElementById('extra').placeholder=p.extraConfig.placeholder||p.extraConfig.label;
    var stored=se(id);
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
  var id=document.getElementById('prov').value; if(!id)return;
  var v=document.getElementById('key').value;
  sv(id,v);
  var c=document.getElementById('chip_'+id);
  if(c){var d=c.querySelector('.dot'); if(d)d.className='dot '+(v||providers[id]&&providers[id].hasServerKey?'ok':'miss')}
  renderMembers();
}

function onExtra(){
  var id=document.getElementById('prov').value; if(!id)return;
  var p=providers[id]; if(!p||!p.extraConfig)return;
  sve(id,{[p.extraConfig.key]:document.getElementById('extra').value});
}

document.getElementById('prov').addEventListener('change',onProv);
document.getElementById('key').addEventListener('input',onKey);
document.getElementById('extra').addEventListener('input',onExtra);
document.getElementById('temp').addEventListener('input',function(){document.getElementById('tv').textContent=this.value});
document.getElementById('c-temp').addEventListener('input',function(){document.getElementById('c-tv').textContent=this.value});

/* ── Chat textarea ── */
var ta=document.getElementById('tinp');
ta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,180)+'px'});
ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});

/* ── Council textarea ── */
var cta=document.getElementById('c-tinp');
cta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,180)+'px'});
cta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitCouncil()}});

/* ── Chat message helpers ── */
function appendMsg(role,html,meta){
  var w=document.getElementById('welcome');
  if(w)w.remove();
  var c=document.getElementById('msgs');
  var d=document.createElement('div');
  d.className='msg '+role;
  var b=document.createElement('div');
  b.className='bubble'; b.innerHTML=html;
  d.appendChild(b);
  if(meta){
    var m=document.createElement('div');
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

function addLoader(){
  var w=document.getElementById('welcome'); if(w)w.remove();
  var c=document.getElementById('msgs');
  var d=document.createElement('div');
  d.id='loader'; d.className='msg assistant';
  d.innerHTML='<div class="bubble"><div class="typing"><div class="tdot"></div><div class="tdot"></div><div class="tdot"></div></div></div>';
  c.appendChild(d); c.scrollTop=c.scrollHeight;
}

function rmLoader(){var l=document.getElementById('loader');if(l)l.remove()}

/* ── Chat send ── */
async function send(){
  if(loading)return;
  var id=document.getElementById('prov').value;
  var model=document.getElementById('model').value;
  var key=document.getElementById('key').value;
  var text=ta.value.trim();
  var temp=parseFloat(document.getElementById('temp').value);
  var mtok=parseInt(document.getElementById('mtok').value);

  if(!text)return;
  if(!id){alert('Please select a provider');return}
  if(!model){alert('Please select a model');return}

  var p=providers[id];
  var extra={};
  if(p&&p.extraConfig){extra=se(id)}

  msgs.push({role:'user',content:text});
  appendMsg('user',esc(text).replace(/\\n/g,'<br>'));
  ta.value=''; ta.style.height='auto';

  loading=true;
  document.getElementById('sbtn').disabled=true;
  addLoader();

  try{
    var res=await fetch('/api/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({providerId:id,model:model,apiKey:key,messages:msgs.slice(-20),temperature:temp,maxTokens:mtok,extraConfig:extra})
    });
    var data=await res.json();
    rmLoader();
    if(data.error){
      var ed=document.createElement('div');
      ed.className='err'; ed.textContent='Error: '+data.error;
      document.getElementById('msgs').appendChild(ed);
      document.getElementById('msgs').scrollTop=9999;
      msgs.pop();
    } else {
      msgs.push({role:'assistant',content:data.content});
      appendMsg('assistant',esc(data.content).replace(/\\n/g,'<br>'),{
        provider:data.provider, model:data.model,
        latency:data.latencyMs, tokens:data.usage&&data.usage.totalTokens
      });
    }
  } catch(e){
    rmLoader();
    var ed=document.createElement('div');
    ed.className='err'; ed.textContent='Network error: '+e.message;
    document.getElementById('msgs').appendChild(ed);
    document.getElementById('msgs').scrollTop=9999;
    msgs.pop();
  } finally {
    loading=false;
    document.getElementById('sbtn').disabled=false;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   COUNCIL MODE
───────────────────────────────────────────────────────────────────────── */

function addMember(){
  if(cMembers.length>=5)return;
  var ids=Object.keys(providers);
  if(!ids.length)return;
  var pid=ids[0];
  var mod=providers[pid]&&providers[pid].models[0]?providers[pid].models[0].id:'';
  cMembers.push({providerId:pid,model:mod});
  renderMembers();
}

function removeMember(i){
  cMembers.splice(i,1);
  renderMembers();
}

function updateMember(i,field,val){
  if(field==='prov'){
    cMembers[i].providerId=val;
    cMembers[i].model=providers[val]&&providers[val].models[0]?providers[val].models[0].id:'';
  } else {
    cMembers[i].model=val;
  }
  renderMembers();
}

function renderMembers(){
  var list=document.getElementById('c-members');
  list.innerHTML='';
  cMembers.forEach(function(m,i){
    var row=document.createElement('div');
    row.className='member-row';

    /* provider select */
    var ps=document.createElement('select');
    Object.values(providers).forEach(function(p){
      var o=document.createElement('option');
      o.value=p.id; o.textContent=p.name;
      if(p.id===m.providerId)o.selected=true;
      ps.appendChild(o);
    });
    ps.onchange=function(){updateMember(i,'prov',this.value)};

    /* model select */
    var ms=document.createElement('select');
    var prov=providers[m.providerId];
    if(prov&&prov.models){
      prov.models.forEach(function(mod){
        var o=document.createElement('option');
        o.value=mod.id; o.textContent=mod.name;
        if(mod.id===m.model)o.selected=true;
        ms.appendChild(o);
      });
    }
    ms.onchange=function(){updateMember(i,'mod',this.value)};

    /* no-key warning */
    var hasKey=sk(m.providerId)||(providers[m.providerId]&&providers[m.providerId].hasServerKey);
    var warn=hasKey?'':'<span class="no-key" title="No API key — set one in Chat tab">&#9888;</span>';

    /* remove button */
    var rb=document.createElement('button');
    rb.className='rm-btn'; rb.textContent='&#x2715;';
    rb.onclick=function(){removeMember(i)};

    row.appendChild(ps);
    row.appendChild(ms);
    if(!hasKey){var ws=document.createElement('span'); ws.className='no-key'; ws.title='No API key — set one in Chat tab'; ws.textContent='!'; row.appendChild(ws)}
    row.appendChild(rb);
    list.appendChild(row);
  });

  document.getElementById('c-count').textContent='('+cMembers.length+'/5)';
  var ab=document.getElementById('c-add-btn');
  if(ab)ab.disabled=cMembers.length>=5;
}

/* ── Council helpers ── */
function addCLoader(scroll,text){
  var d=document.createElement('div');
  d.className='c-loader';
  d.innerHTML='<div class="typing"><div class="tdot"></div><div class="tdot"></div><div class="tdot"></div></div><span>'+esc(text)+'</span>';
  scroll.appendChild(d);
  scroll.scrollTop=scroll.scrollHeight;
  return d;
}

function addCError(scroll,text){
  var d=document.createElement('div');
  d.className='err'; d.style.margin='12px 20px';
  d.textContent=text;
  scroll.appendChild(d);
}

function renderAnswerGrid(scroll,answers){
  var ph=document.createElement('div');
  ph.className='phase-hdr'; ph.textContent='Phase 1 — Individual Answers';
  scroll.appendChild(ph);

  var grid=document.createElement('div');
  grid.className='council-grid';

  answers.forEach(function(a,i){
    var card=document.createElement('div');
    card.className='a-card'; card.id='c-card-'+i;
    var prov=providers[a.member.providerId];
    var provName=prov?prov.name:a.member.providerId;

    var body=a.error
      ?'<div class="err" style="font-size:11px">'+esc(a.error)+'</div>'
      :'<div class="a-body">'+esc(a.content).replace(/\\n/g,'<br>')+'</div>';

    card.innerHTML=
      '<div class="a-hdr">'+
        '<div>'+
          '<div class="a-prov">'+esc(provName)+'</div>'+
          '<div class="a-model">'+esc(a.member.model)+'</div>'+
        '</div>'+
        '<div class="a-votes">'+
          '<div class="a-vcount" id="c-vc-'+i+'">&#8212;</div>'+
          '<div class="a-vlbl">votes</div>'+
        '</div>'+
      '</div>'+
      body+
      '<div class="a-latency">'+a.latencyMs+'ms</div>';

    grid.appendChild(card);
  });

  scroll.appendChild(grid);
}

function applyVotes(tally,winner){
  tally.forEach(function(count,i){
    var vc=document.getElementById('c-vc-'+i);
    if(vc)vc.textContent=count;
    if(i===winner){
      var card=document.getElementById('c-card-'+i);
      if(card){
        card.classList.add('winner');
        var hdr=card.querySelector('.a-hdr');
        if(hdr){
          var wb=document.createElement('span');
          wb.className='w-banner'; wb.textContent='🏆 Winner';
          hdr.appendChild(wb);
        }
      }
    }
  });
}

function renderVoteBreakdown(scroll,answers,votesData){
  var ph=document.createElement('div');
  ph.className='phase-hdr'; ph.textContent='Phase 2 — Votes & Reasoning';
  scroll.appendChild(ph);

  var lines=document.createElement('div');
  lines.className='vote-lines';

  votesData.votes.forEach(function(v){
    var line=document.createElement('div');
    line.className='v-line';
    var prov=providers[v.voter.providerId];
    var voterName=prov?prov.name:v.voter.providerId;
    if(v.error){
      line.innerHTML='<span class="v-voter">'+esc(voterName)+'</span><span class="v-err">'+esc(v.error)+'</span>';
    } else {
      line.innerHTML=
        '<span class="v-voter">'+esc(voterName)+'</span>'+
        '<span class="v-for">&#8594; Answer '+(v.votedFor+1)+'</span>'+
        '<span class="v-reason">"'+esc(v.reasoning)+'"</span>';
    }
    lines.appendChild(line);
  });

  scroll.appendChild(lines);

  /* winner summary card */
  var validVotes=votesData.votes.filter(function(v){return!v.error}).length;
  var wc=document.createElement('div');
  wc.className='winner-card';

  if(votesData.winner>=0&&answers[votesData.winner]){
    var wa=answers[votesData.winner];
    var wp=providers[wa.member.providerId];
    var wpName=wp?wp.name:wa.member.providerId;
    wc.innerHTML=
      '<div class="winner-icon">🏆</div>'+
      '<div>'+
        '<div style="font-size:14px;font-weight:700;color:#fff">Winner: '+esc(wa.member.model)+'</div>'+
        '<div style="font-size:11px;color:rgba(255,255,255,.7)">'+esc(wpName)+' &middot; '+votesData.tally[votesData.winner]+' of '+validVotes+' votes</div>'+
      '</div>';
  } else {
    wc.innerHTML=
      '<div class="winner-icon">🤝</div>'+
      '<div>'+
        '<div style="font-size:14px;font-weight:700;color:#fff">It\'s a tie!</div>'+
        '<div style="font-size:11px;color:rgba(255,255,255,.7)">Multiple answers received equal votes</div>'+
      '</div>';
  }
  scroll.appendChild(wc);
}

/* ── Submit council ── */
async function submitCouncil(){
  if(cLoading)return;
  var prompt=cta.value.trim();
  if(!prompt)return;
  if(cMembers.length<2){alert('Add at least 2 council members in the sidebar.');return}

  var members=cMembers.map(function(m){
    return{providerId:m.providerId,model:m.model,apiKey:sk(m.providerId),extraConfig:se(m.providerId)};
  });
  var temp=parseFloat(document.getElementById('c-temp').value);
  var mtok=parseInt(document.getElementById('c-mtok').value);

  cLoading=true;
  document.getElementById('c-sbtn').disabled=true;
  cta.value=''; cta.style.height='auto';

  var scroll=document.getElementById('c-scroll');
  scroll.innerHTML='';

  /* prompt header */
  var ph=document.createElement('div');
  ph.className='prompt-hdr';
  ph.innerHTML='<div class="prompt-lbl">Council Prompt</div><div class="prompt-txt">'+esc(prompt)+'</div>';
  scroll.appendChild(ph);

  /* Phase 1 */
  var l1=addCLoader(scroll,'Phase 1 — Gathering answers from '+members.length+' models…');
  var answersData;
  try{
    var r1=await fetch('/api/council/answers',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt:prompt,members:members,temperature:temp,maxTokens:mtok})
    });
    answersData=await r1.json();
  } catch(e){
    l1.remove();
    addCError(scroll,'Network error in Phase 1: '+e.message);
    cLoading=false; document.getElementById('c-sbtn').disabled=false;
    return;
  }
  l1.remove();

  if(answersData.error){
    addCError(scroll,answersData.error);
    cLoading=false; document.getElementById('c-sbtn').disabled=false;
    return;
  }

  renderAnswerGrid(scroll,answersData.answers);

  /* Phase 2 */
  var l2=addCLoader(scroll,'Phase 2 — Collecting votes…');
  var votesData;
  try{
    var r2=await fetch('/api/council/votes',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt:prompt,answers:answersData.answers,members:members})
    });
    votesData=await r2.json();
  } catch(e){
    l2.remove();
    addCError(scroll,'Network error in Phase 2: '+e.message);
    cLoading=false; document.getElementById('c-sbtn').disabled=false;
    return;
  }
  l2.remove();

  if(votesData.error){
    addCError(scroll,votesData.error);
  } else {
    applyVotes(votesData.tally,votesData.winner);
    renderVoteBreakdown(scroll,answersData.answers,votesData);
  }

  cLoading=false;
  document.getElementById('c-sbtn').disabled=false;
  scroll.scrollTop=scroll.scrollHeight;
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

// ─── Council Types ────────────────────────────────────────────────────────────

interface CouncilMember {
  providerId: string;
  model: string;
  apiKey?: string;
  extraConfig?: Record<string, string>;
}

interface CouncilAnswer {
  member: { providerId: string; model: string };
  content: string;
  latencyMs: number;
  error: string | null;
}

interface CouncilVote {
  voter: { providerId: string; model: string };
  votedFor: number;
  reasoning: string;
  error: string | null;
}

// ─── Vote Response Parser ─────────────────────────────────────────────────────
// Tries multiple strategies because models vary in how strictly they follow
// the JSON-only instruction.

function parseVote(text: string, n: number): { vote: number; reasoning: string } {
  const t = text.trim();

  // 1. Entire response is JSON
  try {
    const d = JSON.parse(t) as { vote?: unknown; reasoning?: unknown };
    const v = Number(d.vote);
    if (Number.isInteger(v) && v >= 1 && v <= n) {
      return { vote: v - 1, reasoning: String(d.reasoning ?? "").slice(0, 300) };
    }
  } catch { /* continue */ }

  // 2. JSON object embedded somewhere in text
  const objM = t.match(/\{[\s\S]*?"vote"\s*:\s*(\d+)[\s\S]*?\}/);
  if (objM) {
    try {
      const d = JSON.parse(objM[0]) as { vote?: unknown; reasoning?: unknown };
      const v = Number(d.vote);
      if (Number.isInteger(v) && v >= 1 && v <= n) {
        return { vote: v - 1, reasoning: String(d.reasoning ?? "").slice(0, 300) };
      }
    } catch { /* continue */ }
    const v2 = parseInt(objM[1], 10);
    if (v2 >= 1 && v2 <= n) return { vote: v2 - 1, reasoning: t.slice(0, 200) };
  }

  // 3. "vote: N" / "Answer N" / "option N" patterns
  const lM = t.match(/(?:vote|answer|option|choice)[:\s#]+(\d+)/i);
  if (lM) {
    const v = parseInt(lM[1], 10);
    if (v >= 1 && v <= n) return { vote: v - 1, reasoning: t.slice(0, 200) };
  }

  // 4. Standalone digit
  const dM = t.match(/\b([1-9])\b/);
  if (dM) {
    const v = parseInt(dM[1], 10);
    if (v >= 1 && v <= n) return { vote: v - 1, reasoning: t.slice(0, 200) };
  }

  return { vote: 0, reasoning: "Could not parse vote response" };
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

// Phase 1: each member answers the prompt independently (parallel)
async function handleCouncilAnswers(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);

  let body: { prompt?: string; members?: CouncilMember[]; temperature?: number; maxTokens?: number };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const { prompt, members, temperature = 0.7, maxTokens = 512 } = body;
  if (!prompt || !Array.isArray(members) || members.length === 0) {
    json(res, 400, { error: "prompt and members are required" });
    return;
  }

  const jobs = members.map(async (m): Promise<CouncilAnswer> => {
    const provider = PROVIDERS.get(m.providerId);
    if (!provider) {
      return { member: { providerId: m.providerId, model: m.model }, content: "", latencyMs: 0, error: `Unknown provider: ${m.providerId}` };
    }
    const apiKey = process.env[provider.info.envVar] ?? m.apiKey ?? "";
    if (!apiKey) {
      return { member: { providerId: m.providerId, model: m.model }, content: "", latencyMs: 0, error: `No API key for ${provider.info.name}. Enter one in the Chat tab.` };
    }
    const t0 = Date.now();
    try {
      const r = await provider.chat({
        messages: [{ role: "user", content: prompt }],
        model: m.model, apiKey, extraConfig: m.extraConfig, temperature, maxTokens,
      });
      return { member: { providerId: m.providerId, model: m.model }, content: r.content, latencyMs: r.latencyMs, error: null };
    } catch (err) {
      return { member: { providerId: m.providerId, model: m.model }, content: "", latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const answers = await Promise.all(jobs);
  json(res, 200, { answers });
}

// Phase 2: each member reads all answers and votes for the best one (parallel)
async function handleCouncilVotes(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);

  let body: { prompt?: string; answers?: CouncilAnswer[]; members?: CouncilMember[] };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const { prompt, answers, members } = body;
  if (!prompt || !Array.isArray(answers) || !Array.isArray(members)) {
    json(res, 400, { error: "prompt, answers, and members are required" });
    return;
  }

  const valid = answers.filter((a) => !a.error && a.content.trim());
  if (valid.length < 2) {
    const tally = answers.map(() => 0);
    const soleIdx = valid.length === 1 ? answers.indexOf(valid[0]) : -1;
    if (soleIdx >= 0) tally[soleIdx] = members.length;
    json(res, 200, { votes: [], tally, winner: soleIdx });
    return;
  }

  const answerBlock = valid.map((a, i) => {
    const name = PROVIDERS.get(a.member.providerId)?.info.name ?? a.member.providerId;
    return `[Answer ${i + 1}] ${name} / ${a.member.model}\n${a.content}`;
  }).join("\n\n---\n\n");

  const sys = `You are an impartial judge in an AI council. Evaluate answers to the same question and vote for the best one. Respond with ONLY valid JSON — no other text: {"vote": <1 to ${valid.length}>, "reasoning": "<1-2 sentences>"}`;
  const usr = `Question: "${prompt}"\n\n${answerBlock}\n\nVote for the most accurate, clear, and helpful answer. Respond ONLY with: {"vote": <1 to ${valid.length}>, "reasoning": "<reasoning>"}`;

  const jobs = members.map(async (m): Promise<CouncilVote> => {
    const provider = PROVIDERS.get(m.providerId);
    if (!provider) return { voter: { providerId: m.providerId, model: m.model }, votedFor: 0, reasoning: "", error: "Unknown provider" };
    const apiKey = process.env[provider.info.envVar] ?? m.apiKey ?? "";
    if (!apiKey) return { voter: { providerId: m.providerId, model: m.model }, votedFor: 0, reasoning: "", error: "No API key" };
    try {
      const r = await provider.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        model: m.model, apiKey, extraConfig: m.extraConfig, temperature: 0.3, maxTokens: 200,
      });
      const parsed = parseVote(r.content, valid.length);
      const origIdx = answers.indexOf(valid[parsed.vote]);
      return { voter: { providerId: m.providerId, model: m.model }, votedFor: origIdx >= 0 ? origIdx : 0, reasoning: parsed.reasoning, error: null };
    } catch (err) {
      return { voter: { providerId: m.providerId, model: m.model }, votedFor: 0, reasoning: "", error: err instanceof Error ? err.message : String(err) };
    }
  });

  const votes = await Promise.all(jobs);

  const tally = answers.map(() => 0);
  votes.filter((v) => !v.error).forEach((v) => { tally[v.votedFor]++; });

  const maxV = Math.max(...tally);
  const tops = tally.reduce<number[]>((a, c, i) => (c === maxV && maxV > 0 ? [...a, i] : a), []);
  const winner = tops.length === 1 ? tops[0] : -1;

  json(res, 200, { votes, tally, winner });
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
      try { await handleChat(req, res); }
      catch (err) { json(res, 500, { error: err instanceof Error ? err.message : "Internal error" }); }
      return;
    }

    if (req.method === "POST" && url === "/api/council/answers") {
      try { await handleCouncilAnswers(req, res); }
      catch (err) { json(res, 500, { error: err instanceof Error ? err.message : "Internal error" }); }
      return;
    }

    if (req.method === "POST" && url === "/api/council/votes") {
      try { await handleCouncilVotes(req, res); }
      catch (err) { json(res, 500, { error: err instanceof Error ? err.message : "Internal error" }); }
      return;
    }

    json(res, 404, { error: "Not found" });
  });
}

// ─── Startup ──────────────────────────────────────────────────────────────────

function getLocalIP(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of (ifaces[name] ?? [])) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

export function startServer(): void {
  const server = createServer();
  const host = process.env["HOST"] ?? "0.0.0.0";
  server.listen(PORT, host, () => {
    const ip = getLocalIP();
    console.log(`\n🤖  Free LLM Chatbot is running!\n`);
    console.log(`  Local:   http://localhost:${PORT}`);
    if (ip !== "localhost") console.log(`  Network: http://${ip}:${PORT}`);
    console.log(`\nConfigured providers:`);
    ALL_PROVIDERS.forEach((p) => console.log(`  ${process.env[p.info.envVar] ? "✓" : "○"} ${p.info.name}`));
    console.log(`\nPress Ctrl+C to stop.\n`);
  });
}
