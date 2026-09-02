import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv(path.join(__dirname, '.env'));
const cfg = {
  apiKey: process.env.OPENSEA_API_KEY || env.OPENSEA_API_KEY || '',
  wallets: split(process.env.WALLETS || env.WALLETS),
  slugs: split(process.env.WATCH_SLUGS || env.WATCH_SLUGS),
  pollMs: Number(process.env.POLL_MS || env.POLL_MS || 3000),
  maxValue: BigInt(process.env.MAX_MINT_VALUE_WEI || env.MAX_MINT_VALUE_WEI || '500000000000000'),
  maxQty: Number(process.env.MAX_QUANTITY || env.MAX_QUANTITY || 1),
  port: Number(process.env.PORT || env.PORT || 4317),
  chainId: Number(process.env.RH_CHAIN_ID || env.RH_CHAIN_ID || 4663),
  rpc: process.env.RH_RPC_URL || env.RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'
};

if (!cfg.apiKey) fail('OPENSEA_API_KEY is required. Copy .env.example to .env and fill it.');
if (!cfg.wallets.length) fail('WALLETS is required. Use public wallet addresses only.');
if (!cfg.slugs.length) fail('WATCH_SLUGS is required.');
if (cfg.pollMs < 1500) fail('POLL_MS below 1500ms is blocked to avoid accidental API hammering.');

const state = new Map();
const prepared = new Map();
const log = [];
const once = process.argv.includes('--once');

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#') && x.includes('=')).map(line=>{
    const i=line.indexOf('='); return [line.slice(0,i).trim(), line.slice(i+1).trim()];
  }));
}
function split(v=''){ return v.split(',').map(x=>x.trim()).filter(Boolean); }
function fail(s){ console.error(s); process.exit(1); }
function now(){ return new Date().toISOString(); }
function push(type, message, data={}){
  const e={time:now(),type,message,...data}; log.unshift(e); if(log.length>200) log.pop(); console.log(`[${e.time}] ${type}: ${message}`); return e;
}
function weiLabel(v){ const n=Number(v)/1e18; return `${n.toFixed(6)} ETH`; }
function activeStage(stage){
  const t=Date.now(); const a=stage?.startTime ? Date.parse(stage.startTime) : -Infinity; const b=stage?.endTime ? Date.parse(stage.endTime) : Infinity;
  return t>=a && t<=b;
}
function stagePriceWei(stage){
  const candidates=[stage?.price?.value, stage?.price?.amount, stage?.price, stage?.mintPrice];
  for(const v of candidates){ if(typeof v==='string' && /^\d+$/.test(v)) return BigInt(v); if(typeof v==='number' && Number.isFinite(v)) return BigInt(Math.trunc(v)); }
  return null;
}
function stageLabel(stage){ return String(stage?.label || stage?.name || stage?.stage || 'unknown'); }

async function os(pathname, init={}){
  const r=await fetch(`https://api.opensea.io${pathname}`, { ...init, headers:{'X-API-KEY':cfg.apiKey,'Content-Type':'application/json',...(init.headers||{})} });
  const text=await r.text(); let body; try{body=JSON.parse(text);}catch{body={raw:text};}
  if(!r.ok){ const err=new Error(`OpenSea ${r.status}`); err.status=r.status; err.body=body; throw err; }
  return body;
}
async function rpc(method, params=[]){
  const r=await fetch(cfg.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const j=await r.json(); if(j.error) throw new Error(`RPC ${j.error.message}`); return j.result;
}
async function getCode(addr){ return rpc('eth_getCode',[addr,'latest']); }

function dropContract(drop){
  const vals=[drop?.contractAddress,drop?.contract_address,drop?.contract?.address,drop?.collection?.primary_asset_contracts?.[0]?.address];
  return vals.find(v=>typeof v==='string' && /^0x[0-9a-fA-F]{40}$/.test(v)) || null;
}
function dropChain(drop){
  return drop?.chain?.identifier || drop?.chain || drop?.blockchain || drop?.network || null;
}

async function buildTx(slug,wallet){
  try {
    const tx=await os(`/api/v2/drops/${encodeURIComponent(slug)}/mint`,{method:'POST',body:JSON.stringify({minter:wallet,quantity:cfg.maxQty})});
    const to=tx.target || tx.to; const data=tx.calldata || tx.data; const value=BigInt(tx.value || '0');
    if(!/^0x[0-9a-fA-F]{40}$/.test(to||'')) throw new Error('Bad target address');
    if(!/^0x[0-9a-fA-F]*$/.test(data||'')) throw new Error('Bad calldata');
    if(value>cfg.maxValue) throw new Error(`BLOCKED_VALUE ${weiLabel(value)} > ${weiLabel(cfg.maxValue)}`);
    const code=await getCode(to);
    if(!code || code==='0x') throw new Error('BLOCKED_EOA target has no contract bytecode');
    return {to,data,value:value.toString(),chainId:cfg.chainId};
  } catch(e){ return {error:e.message,status:e.status||null,detail:e.body||null}; }
}

async function inspect(slug){
  let drop;
  try { drop=await os(`/api/v2/drops/${encodeURIComponent(slug)}`); }
  catch(e){ push('ERROR',`${slug}: drop lookup failed (${e.status||''})`); return; }
  const supply=Number(drop.totalSupply ?? drop.total_supply ?? 0); const max=Number(drop.maxSupply ?? drop.max_supply ?? 0);
  const stages=Array.isArray(drop.stages)?drop.stages:[];
  const actives=stages.filter(activeStage);
  const fingerprint=JSON.stringify({supply,max,actives:actives.map(s=>({l:stageLabel(s),p:String(stagePriceWei(s)),e:s.endTime||null}))});
  if(state.get(slug)===fingerprint && !once) return;
  state.set(slug,fingerprint);

  const contract=dropContract(drop); const chain=dropChain(drop);
  push('CHECK',`${slug}: ${supply}/${max||'?'} active=${actives.map(stageLabel).join('|')||'none'}`,{slug,supply,max,contract,chain});

  for(const stage of actives){
    const price=stagePriceWei(stage); if(price!==null && price>cfg.maxValue){ push('BLOCK',`${slug}/${stageLabel(stage)}: price ${weiLabel(price)} exceeds safety cap`); continue; }
    for(const wallet of cfg.wallets){
      const tx=await buildTx(slug,wallet);
      const key=`${slug}:${wallet.toLowerCase()}`;
      if(tx.error){ prepared.delete(key); if(tx.status===422) push('NOPE',`${slug}: wallet ${wallet.slice(0,8)}… not eligible / precondition failed`); else push('BLOCK',`${slug}: ${wallet.slice(0,8)}… ${tx.error}`); continue; }
      // Contract cross-check when OpenSea exposes the collection contract. SeaDrop may target a mint proxy,
      // so mismatch is not auto-approved; it becomes a manual-warning gate in the UI.
      const contractMismatch=Boolean(contract && contract.toLowerCase()!==tx.to.toLowerCase());
      const item={slug,wallet,stage:stageLabel(stage),priceWei:tx.value,priceEth:weiLabel(BigInt(tx.value)),supply,max,collectionContract:contract,target:tx.to,data:tx.data,chainId:cfg.chainId,contractMismatch,preparedAt:now()};
      prepared.set(key,item);
      push(contractMismatch?'WARN':'READY',`${slug}: ${wallet.slice(0,8)}… ${stageLabel(stage)} ${item.priceEth}${contractMismatch?' target differs; manual check required':''}`,{slug,wallet});
    }
  }
}

async function cycle(){ for(const s of cfg.slugs) await inspect(s); }

const html=fs.readFileSync(path.join(__dirname,'public','index.html'),'utf8');
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname==='/'){ res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); return res.end(html); }
  if(url.pathname==='/api/status'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    return res.end(JSON.stringify({chainId:cfg.chainId,rpc:cfg.rpc,maxMintValueWei:cfg.maxValue.toString(),pollMs:cfg.pollMs,prepared:[...prepared.values()],log:log.slice(0,60)}));
  }
  res.writeHead(404); res.end('not found');
});

await cycle();
if(once){ process.exit(0); }
server.listen(cfg.port,'127.0.0.1',()=>push('START',`FingerCheck UI http://127.0.0.1:${cfg.port}`));
setInterval(()=>cycle().catch(e=>push('ERROR',e.message)),cfg.pollMs);
