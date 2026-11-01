// Loopback-only prototype. Demo credentials are intentionally not production accounts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {seed,apply,scope,can,VERSION} from './domain.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),PORT=Number(process.env.OMNI_PORT||8765),DATA=process.env.OMNI_DATA_DIR||path.join(ROOT,'data');
fs.mkdirSync(DATA,{recursive:true,mode:0o700});
const stateFile=path.join(DATA,'state.json'),authFile=path.join(DATA,'auth.json');
function persist(file,value){const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):seed();
if(state.version!==VERSION)throw Error('Versi data tidak cocok. Cadangkan data sebelum migrasi.');
state.revision??=0;if(!fs.existsSync(stateFile))persist(stateFile,state);
if(!fs.existsSync(authFile))persist(authFile,[['owner.demo','owner','OwnerDemo!2026'],['gudang.demo','gudang','GudangDemo!2026'],['auditor.demo','auditor','AuditorDemo!2026']].map(([userid,actor,password])=>{const salt=crypto.randomBytes(16).toString('hex');return {userid,actor,salt,hash:crypto.scryptSync(password,salt,64).toString('hex')};}));
const accounts=JSON.parse(fs.readFileSync(authFile,'utf8')),sessions=new Map(),failures=new Map();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function session(req){const token=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('omni_session='))?.slice(13);if(!token)return null;const key=hash(token),value=sessions.get(key);if(!value||value.expires<Date.now()){sessions.delete(key);return null;}return {...value,key};}
function send(res,code,data,headers={}){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let data='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>65536){reject(Error('Permintaan terlalu besar.'));req.destroy();return;}data+=chunk;});req.on('end',()=>{try{const x=JSON.parse(data||'{}');if(!x||Array.isArray(x)||typeof x!=='object')throw Error();resolve(x);}catch{reject(Error('JSON tidak valid.'));}});req.on('error',reject);});}
function publicState(actor){const copy=structuredClone(state);copy.lots=copy.lots.filter(l=>scope(state,actor,l.warehouse));copy.orders=copy.orders.filter(o=>scope(state,actor,o.warehouse));copy.counts=copy.counts.filter(c=>scope(state,actor,c.warehouse));copy.audit=copy.audit.filter(a=>!a.warehouse||scope(state,actor,a.warehouse));const lots=new Set(copy.lots.map(l=>l.id));copy.movements=copy.movements.filter(m=>lots.has(m.lotId));copy.receipts=[];if(!can(state,actor,'cost.read')){copy.products.forEach(p=>p.cost=null);copy.orders.forEach(o=>o.cost=null);}return copy;}
const server=http.createServer(async(req,res)=>{
 const host=req.headers.host||'';if(!['127.0.0.1:'+PORT,'localhost:'+PORT].includes(host)){send(res,403,{error:'Host tidak diizinkan.'});return;}
 const url=new URL(req.url,'http://'+host),s=session(req);
 try{
  if(url.pathname.startsWith('/api/')){
   if(req.method==='POST'){if(req.headers.origin!=='http://'+host){send(res,403,{error:'Origin tidak diizinkan.'});return;}if(!(req.headers['content-type']||'').startsWith('application/json')){send(res,415,{error:'Gunakan JSON.'});return;}}
   if(req.method==='POST'&&url.pathname==='/api/login'){
    const p=await body(req),ip=req.socket.remoteAddress,bucket=failures.get(ip)||{count:0,until:Date.now()+60000};if(bucket.until<Date.now()){bucket.count=0;bucket.until=Date.now()+60000;}if(bucket.count>=8){send(res,429,{error:'Terlalu banyak percobaan. Tunggu satu menit.'});return;}
    if(typeof p.userid!=='string'||typeof p.password!=='string'||p.userid.length>80||p.password.length>256){send(res,400,{error:'Userid atau password tidak valid.'});return;}
    const account=accounts.find(a=>a.userid===p.userid.trim().toLowerCase()),computed=crypto.scryptSync(p.password,account?.salt||'dummy-salt',64);
    if(!account||!crypto.timingSafeEqual(computed,Buffer.from(account.hash,'hex'))){bucket.count++;failures.set(ip,bucket);send(res,401,{error:'Userid atau password salah.'});return;}
    failures.delete(ip);if(s)sessions.delete(s.key);const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');sessions.set(hash(token),{actor:account.actor,csrf,expires:Date.now()+8*3600000});send(res,200,{actor:account.actor,csrf,state:publicState(account.actor)},{'Set-Cookie':`omni_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`});return;
   }
   if(!s){send(res,401,{error:'Silakan masuk dengan userid dan password.'});return;}
   if(req.method==='GET'&&url.pathname==='/api/session'){send(res,200,{actor:s.actor,csrf:s.csrf,state:publicState(s.actor)});return;}
   if(req.method==='GET'&&url.pathname==='/api/state'){send(res,200,publicState(s.actor));return;}
   if(req.method==='GET'&&url.pathname==='/api/export'){if(!state.users.find(u=>u.id===s.actor)?.owner){send(res,403,{error:'Ekspor hanya untuk Owner.'});return;}send(res,200,state,{'Content-Disposition':'attachment; filename="omni-data-contoh.json"'});return;}
   if(req.method==='POST'){
    if(req.headers['x-csrf-token']!==s.csrf){send(res,403,{error:'Token sesi tidak valid. Muat ulang halaman.'});return;}const p=await body(req);
    if(url.pathname==='/api/logout'){sessions.delete(s.key);send(res,200,{ok:true},{'Set-Cookie':'omni_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});return;}
    if(url.pathname==='/api/command'||url.pathname==='/api/reset'){
     if(p.revision!==state.revision){send(res,409,{error:'Data berubah di sesi lain. Muat ulang lalu periksa kembali.'});return;}
     let next;if(url.pathname==='/api/reset'){if(!state.users.find(u=>u.id===s.actor)?.owner){send(res,403,{error:'Reset hanya untuk Owner.'});return;}next=seed();}
     else {if(typeof p.type!=='string'||!p.payload||typeof p.payload!=='object'||Array.isArray(p.payload))throw Error('Perintah tidak valid.');next=apply(state,s.actor,p.type,p.payload);}
     next.revision=state.revision+1;persist(stateFile,next);state=next;send(res,200,publicState(s.actor));return;
    }
   }
   send(res,404,{error:'Endpoint tidak tersedia.'});return;
  }
  if(!['GET','HEAD'].includes(req.method)){send(res,405,{error:'Metode tidak diizinkan.'});return;}
  const files={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.mjs':'app.mjs','/domain.mjs':'domain.mjs','/assets/logo.png':'assets/logo.png','/assets/botol.jpg':'assets/botol.jpg','/assets/bra.jpg':'assets/bra.jpg','/assets/warmer.jpg':'assets/warmer.jpg'},file=files[url.pathname];if(!file){send(res,404,{error:'Tidak ditemukan.'});return;}
  const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'},buffer=fs.readFileSync(path.join(ROOT,file));
  res.writeHead(200,{'Content-Type':types[path.extname(file)],'Content-Length':buffer.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(req.method==='HEAD'?undefined:buffer);
 }catch(error){console.error('Request error:',error.message);if(!res.headersSent&&!res.destroyed)send(res,400,{error:error instanceof TypeError?'Data formulir tidak lengkap atau tidak valid.':error.message});}
});
setInterval(()=>{const now=Date.now();for(const [k,v]of sessions)if(v.expires<now)sessions.delete(k);for(const [k,v]of failures)if(v.until<now)failures.delete(k);},60000).unref();
server.listen(PORT,'127.0.0.1',()=>console.log(`Omni Prototipe Web: http://127.0.0.1:${PORT} · userid/password demo · localhost only`));
server.on('error',error=>{console.error(error.message);process.exit(1);});
