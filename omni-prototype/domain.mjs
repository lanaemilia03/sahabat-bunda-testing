// Prototype rules shared by UI and the loopback server. Production requires a transactional database.
export const VERSION = 1;
export const permissions = {
  'products.write': 'Tambah produk', 'cost.read': 'Lihat HPP dan laba kotor',
  'stock.receive': 'Terima stok dan batch', 'orders.create': 'Buat pesanan',
  'orders.process': 'Picking, packing, kirim dan batal',
  'counts.create': 'Ajukan hasil opname', 'counts.approve': 'Setujui opname',
};
export const statuses = {reserved:'Dibayar · belum diproses',picking:'Sedang picking',packed:'Siap kurir',shipped:'Dikirim',cancel_pending:'Menunggu restock',cancelled:'Dibatalkan'};
export const warehouses = [{id:'utama',name:'Gudang Utama',branch:'Cabang A'},{id:'cabang',name:'Gudang Cabang',branch:'Cabang B'}];
export const stores=['Shopee A','Shopee B','Shopee C','TikTok Shop A','TikTok Shop B','TikTok Shop C'];
export const caseStatuses={requested:'Menunggu keputusan',approved:'Disetujui · menunggu dikirim balik',in_transit:'Dalam perjalanan balik',partial:'Diterima sebagian',received:'Diterima admin',closed:'Selesai tanpa barang balik',rejected:'Ditolak'};
export const categories = [{id:'popok',name:'Popok',batch:false,minDays:0},{id:'mpasi',name:'MPASI',batch:true,minDays:30},{id:'perawatan',name:'Perawatan bayi',batch:true,minDays:60},{id:'perlengkapan',name:'Perlengkapan',batch:false,minDays:0}];
export function day(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function plus(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function days(from,to){return Math.round((new Date(to+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/86400000);}
const active=['reserved','picking','packed','cancel_pending'];
function assert(ok,message){if(!ok)throw Error(message);}
function integer(n,min=0){assert(Number.isSafeInteger(n)&&n>=min&&n<=1000000000,'Jumlah harus bilangan bulat yang valid.');return n;}
function text(v,max=120){assert(typeof v==='string'&&v.trim()&&v.trim().length<=max,'Lengkapi teks dengan panjang yang sesuai.');return v.trim();}
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function user(s,id){return s.users.find(u=>u.id===id);}
export function can(s,id,p){const u=user(s,id);return !!u&&(u.owner||u.permissions.includes(p));}
export function scope(s,id,w){const u=user(s,id);return !!u&&(u.owner||u.warehouses.includes(w));}
export function eligible(s,lot,today=day()){
 const p=s.products.find(p=>p.id===lot.productId),cat=categories.find(c=>c.id===p.category);
 return lot.condition==='saleable'&&(!cat.batch||(lot.batch&&validDate(lot.expiry)&&days(today,lot.expiry)>=cat.minDays));
}
export function reserved(s,lotId){return s.orders.filter(o=>active.includes(o.status)).flatMap(o=>o.allocations).filter(a=>a.lotId===lotId).reduce((n,a)=>n+a.qty,0);}
export function position(s,lot,today=day()){
 let picking=0,packed=0,restock=0;
 for(const o of s.orders){const q=o.allocations.filter(a=>a.lotId===lot.id).reduce((n,a)=>n+a.qty,0);if(o.status==='picking')picking+=q;if(o.status==='packed')packed+=q;if(o.status==='cancel_pending')restock+=q;}
 const allocated=reserved(s,lot.id),free=eligible(s,lot,today)?Math.max(0,lot.qty-allocated):0;
 return {physical:lot.qty,reserved:allocated,available:free,picking,packed,restock,rack:lot.qty-picking-packed-restock,blocked:eligible(s,lot,today)?0:lot.qty};
}
export function stock(s,actor,warehouse='all',productId=null,today=day()){
 const total={physical:0,reserved:0,available:0,picking:0,packed:0,restock:0,rack:0,blocked:0};
 for(const l of s.lots.filter(l=>scope(s,actor,l.warehouse)&&(warehouse==='all'||l.warehouse===warehouse)&&(!productId||l.productId===productId))){const p=position(s,l,today);for(const key in total)total[key]+=p[key];}return total;
}
function requireAccess(s,actor,permission,warehouse){assert(can(s,actor,permission),'Peran ini tidak berwenang melakukan tindakan tersebut.');if(warehouse)assert(scope(s,actor,warehouse),'Gudang di luar penugasan pengguna.');}
function log(s,actor,action,detail,warehouse=null){s.sequence++;s.audit.unshift({id:s.sequence,actor,action,detail,warehouse,at:new Date().toISOString()});}
function movement(s,lot,delta,reason,ref){s.movements.unshift({lotId:lot.id,delta,reason,ref,at:new Date().toISOString()});}
function reserve(s,actor,p,today){
 requireAccess(s,actor,'orders.create',p.warehouse);assert(warehouses.some(w=>w.id===p.warehouse),'Gudang tidak ditemukan.');
 const qty=integer(p.qty,1),product=s.products.find(x=>x.id===p.productId);assert(product,'Produk tidak ditemukan.');
 assert(Number.isSafeInteger(product.price*qty)&&(product.cost===null||Number.isSafeInteger(product.cost*qty)),'Nilai pesanan terlalu besar.');
 const reference=text(p.reference,60);assert(!s.orders.some(o=>o.reference===reference),'Nomor pesanan sudah digunakan.');
 let remaining=qty;const allocations=[];
 const lots=s.lots.filter(l=>l.productId===p.productId&&l.warehouse===p.warehouse&&eligible(s,l,today)).sort((a,b)=>(a.expiry||'9999').localeCompare(b.expiry||'9999')||a.received.localeCompare(b.received));
 for(const lot of lots){const take=Math.min(remaining,lot.qty-reserved(s,lot.id));if(take>0){allocations.push({lotId:lot.id,qty:take});remaining-=take;}if(!remaining)break;}
 assert(!remaining,'Stok layak tersedia tidak mencukupi. Periksa reservasi, batch, atau minimum umur jual.');
 const order={id:'O'+(++s.sequence),reference,customer:text(p.customer),store:text(p.store),warehouse:p.warehouse,productId:product.id,qty,price:product.price,cost:product.cost,status:'reserved',allocations,created:today,history:[{status:'reserved',actor,at:new Date().toISOString()}]};
 order.courier=p.courier?text(p.courier,60):'';order.tracking=p.tracking?text(p.tracking,80):'';
 s.orders.unshift(order);log(s,actor,'Pesanan dibayar',reference+' · '+qty+' '+product.sku,p.warehouse);return order;
}
export function apply(original,actor,type,p={},today=day()){
 const s=structuredClone(original);assert(user(s,actor),'Pilih akun demo terlebih dahulu.');
 if(type==='product'){
  requireAccess(s,actor,'products.write');const sku=text(p.sku,40);assert(!s.products.some(x=>x.sku.toLowerCase()===sku.toLowerCase()),'SKU sudah digunakan.');assert(categories.some(c=>c.id===p.category),'Kategori tidak valid.');
  s.products.push({id:'P'+(++s.sequence),sku,name:text(p.name),category:p.category,price:integer(p.price),cost:p.cost===null?null:integer(p.cost),created:today,minimum:integer(p.minimum),image:null});log(s,actor,'Tambah produk',sku);
 }else if(type==='receive'){
  requireAccess(s,actor,'stock.receive',p.warehouse);assert(warehouses.some(w=>w.id===p.warehouse),'Gudang tidak valid.');const product=s.products.find(x=>x.id===p.productId);assert(product,'Produk tidak ditemukan.');const cat=categories.find(c=>c.id===product.category);const qty=integer(p.qty,1);const condition=p.condition;assert(['saleable','quarantine'].includes(condition),'Kondisi tidak valid.');
  if(cat.batch){text(p.batch,50);assert(validDate(p.expiry),'Kategori ini wajib nomor batch dan tanggal expired yang valid.');if(condition==='saleable')assert(days(today,p.expiry)>=cat.minDays,'Sisa umur terlalu pendek. Terima sebagai karantina untuk pemeriksaan.');}
  else if(p.expiry)assert(validDate(p.expiry),'Tanggal expired tidak valid.');
  if(p.batch)assert(!s.lots.some(l=>l.productId===p.productId&&l.batch===p.batch.trim()&&l.expiry!==(p.expiry||null)),'Batch yang sama memiliki tanggal expired berbeda. Periksa label asli.');
  const reference=text(p.reference,60);assert(!s.receipts.includes(reference),'Referensi penerimaan sudah diproses.');s.receipts.push(reference);
  const lot={id:'L'+(++s.sequence),productId:p.productId,warehouse:p.warehouse,batch:(p.batch||'').trim(),expiry:p.expiry||null,condition,qty,received:today,reference};s.lots.push(lot);movement(s,lot,qty,'Penerimaan',reference);log(s,actor,'Terima barang',reference+' · '+product.sku+' · '+qty,p.warehouse);
 }else if(type==='order'){reserve(s,actor,p,today);
 }else if(type==='case_request'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);
  assert(!o.returnCase,'Pesanan sudah memiliki pengajuan. Buka detail pengajuan yang ada.');assert(['cancel','return','refund'].includes(p.kind),'Jenis pengajuan tidak valid.');
  assert(p.kind==='cancel'?['reserved','picking','packed'].includes(o.status):o.status==='shipped','Jenis pengajuan tidak sesuai tahap pesanan.');
  const qty=p.kind==='return'?integer(p.qty,1):0;assert(qty<=o.qty,'Jumlah retur melebihi pesanan.');
  o.returnCase={kind:p.kind,status:'requested',qty,reason:text(p.reason,240),createdAt:new Date().toISOString(),actor,receipts:[],events:[]};
  log(s,actor,'Catat pengajuan pelanggan',o.reference+' · '+p.kind+' · '+o.returnCase.reason,o.warehouse);
 }else if(type==='case_decide'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);const r=o.returnCase;
  assert(r?.status==='requested','Pengajuan sudah diputuskan.');assert(['approve','reject'].includes(p.decision),'Keputusan tidak valid.');
  r.decisionNote=text(p.reason,240);r.decidedBy=actor;r.decidedAt=new Date().toISOString();
  r.status=p.decision==='reject'?'rejected':r.kind==='return'?'approved':'closed';
  if(p.decision==='approve'&&r.kind==='cancel'){o.status=o.status==='reserved'?'cancelled':'cancel_pending';o.history.push({status:o.status,actor,at:r.decidedAt});}
  r.events.push({at:r.decidedAt,actor,detail:caseStatuses[r.status]+' · '+r.decisionNote});log(s,actor,'Keputusan pengajuan',o.reference+' · '+caseStatuses[r.status],o.warehouse);
 }else if(type==='return_ship'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);const r=o.returnCase;
  assert(r?.kind==='return'&&r.status==='approved','Retur belum disetujui atau sudah dikirim.');assert(validDate(p.sentDate)&&p.sentDate<=today&&p.sentDate>=o.shipped,'Tanggal kirim balik tidak valid.');
  r.courier=text(p.courier,60);r.tracking=text(p.tracking,80);r.sentDate=p.sentDate;r.status='in_transit';r.lastUpdate=text(p.note,240);r.events.push({at:new Date().toISOString(),actor,detail:'Dikirim balik · '+r.courier+' · '+r.tracking+' · '+r.lastUpdate});log(s,actor,'Retur dikirim balik',o.reference+' · '+r.tracking,o.warehouse);
 }else if(type==='return_update'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);const r=o.returnCase;
  assert(['in_transit','partial'].includes(r?.status),'Retur tidak sedang dalam perjalanan.');r.lastUpdate=text(p.note,240);r.events.push({at:new Date().toISOString(),actor,detail:r.lastUpdate});log(s,actor,'Update perjalanan retur',o.reference+' · '+r.lastUpdate,o.warehouse);
 }else if(type==='return_receive'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'stock.receive',o.warehouse);const r=o.returnCase;
  assert(['in_transit','partial'].includes(r?.status),'Retur belum dikirim atau sudah diterima seluruhnya.');
  const allocation=o.allocations.find(a=>a.lotId===p.lotId);assert(allocation,'Batch bukan bagian pesanan ini.');const qty=integer(p.qty,1),received=r.receipts.reduce((n,x)=>n+x.qty,0),batchReceived=r.receipts.filter(x=>x.sourceLotId===p.lotId).reduce((n,x)=>n+x.qty,0);
  assert(qty<=r.qty-received&&qty<=allocation.qty-batchReceived,'Jumlah diterima melebihi sisa retur atau batch asal.');const reference=text(p.reference,80);assert(!s.receipts.includes(reference),'Referensi penerimaan sudah diproses.');const note=text(p.note,240);
  const source=s.lots.find(l=>l.id===p.lotId),lot={...source,id:'L'+(++s.sequence),qty,condition:'quarantine',received:today,reference};s.lots.push(lot);s.receipts.push(reference);movement(s,lot,qty,'Terima retur · karantina',o.reference);
  r.receipts.push({sourceLotId:p.lotId,lotId:lot.id,qty,reference,note,actor,at:new Date().toISOString()});r.status=received+qty===r.qty?'received':'partial';r.events.push({at:new Date().toISOString(),actor,detail:'Admin menerima '+qty+' unit · '+reference+' · '+note});log(s,actor,'Terima retur',o.reference+' · '+qty+' unit masuk karantina',o.warehouse);
 }else if(type==='shipping'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);assert(!o.printJobs?.length,'Pengiriman terkunci setelah permintaan cetak resi.');assert(stores.includes(p.store),'Pilih asal toko.');o.store=p.store;o.courier=text(p.courier,60);o.tracking=text(p.tracking,80);log(s,actor,'Lengkapi pengiriman',o.reference,o.warehouse);
 }else if(type==='print_request'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);
  assert(!['cancelled','cancel_pending'].includes(o.status)&&(!o.returnCase||o.returnCase.status==='rejected'),'Cetak diblokir: ada pembatalan / pengajuan pelanggan.');assert(o.courier&&o.tracking,'Lengkapi ekspedisi dan nomor resi dahulu.');
  o.printJobs??=[];assert(!o.printJobs.some(j=>j.status==='pending'),'Konfirmasi hasil cetak sebelumnya dahulu.');if(o.printJobs.length){assert(p.confirmReprint===true,'Resi pernah diajukan cetak. Konfirmasi cetak ulang diperlukan.');text(p.reason,240);}
  o.printJobs.push({id:++s.sequence,status:'pending',actor,at:new Date().toISOString(),reason:p.reason||'Cetak pertama'});log(s,actor,'Permintaan cetak resi',o.reference,o.warehouse);
 }else if(type==='print_result'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);const j=o.printJobs?.at(-1);assert(j?.status==='pending','Hasil cetak sudah dikonfirmasi.');assert(['printed','failed'].includes(p.result),'Hasil cetak tidak valid.');j.status=p.result;j.confirmedBy=actor;j.confirmedAt=new Date().toISOString();log(s,actor,'Hasil cetak resi',o.reference+' · '+p.result,o.warehouse);
 }else if(type==='transition'){
  const o=s.orders.find(x=>x.id===p.id);assert(o,'Pesanan tidak ditemukan.');requireAccess(s,actor,'orders.process',o.warehouse);
  const allowed={reserved:['picking','cancelled'],picking:['packed','cancel_pending'],packed:['shipped','cancel_pending'],cancel_pending:['cancelled']};
  assert(allowed[o.status]?.includes(p.next),'Status sudah berubah atau tindakan tidak sesuai tahap pesanan.');
  assert(o.returnCase?.status!=='requested','Putuskan pengajuan pelanggan dahulu.');
  if(['picking','packed','shipped'].includes(p.next))assert(!o.returnCase||o.returnCase.status==='rejected','Pemrosesan diblokir karena ada pengajuan pelanggan.');
  if(['picking','packed','shipped'].includes(p.next))for(const a of o.allocations)assert(eligible(s,s.lots.find(l=>l.id===a.lotId),today),'Batch tidak lagi memenuhi kelayakan jual; batalkan dan restock untuk peninjauan.');
  if(p.next==='shipped'){text(p.evidence,120);for(const a of o.allocations){const l=s.lots.find(l=>l.id===a.lotId);assert(l.qty>=a.qty,'Fisik tidak cukup.');l.qty-=a.qty;movement(s,l,-a.qty,'Serah terima',o.reference);}o.shipped=today;o.evidence=p.evidence;}
  const prev=o.status;o.status=p.next;o.history.push({status:p.next,actor,at:new Date().toISOString()});log(s,actor,'Status pesanan',o.reference+' · '+statuses[prev]+' → '+statuses[p.next],o.warehouse);
 }else if(type==='count'){
  const lot=s.lots.find(l=>l.id===p.lotId);assert(lot,'Lot tidak ditemukan.');requireAccess(s,actor,'counts.create',lot.warehouse);
  assert(!s.counts.some(c=>c.lotId===lot.id&&c.status==='pending'),'Masih ada opname menunggu persetujuan untuk lot ini.');assert(p.expected===lot.qty,'Stok berubah selama penghitungan. Buka ulang formulir dan hitung pada cutoff baru.');
  const counted=integer(p.counted);const reason=text(p.reason,240);s.counts.unshift({id:'C'+(++s.sequence),lotId:lot.id,warehouse:lot.warehouse,expected:lot.qty,counted,delta:counted-lot.qty,reason,maker:actor,status:'pending',at:new Date().toISOString()});log(s,actor,'Ajukan opname',lot.id+' · hasil '+counted,lot.warehouse);
 }else if(type==='approve'||type==='reject'){
  const c=s.counts.find(c=>c.id===p.id);assert(c,'Opname tidak ditemukan.');requireAccess(s,actor,'counts.approve',c.warehouse);assert(c.status==='pending','Opname sudah diproses.');assert(c.maker!==actor,'Pembuat dan pemeriksa opname harus berbeda. Ganti akun demo untuk review.');
  const lot=s.lots.find(l=>l.id===c.lotId);if(type==='approve'){assert(lot.qty+c.delta>=reserved(s,lot.id),'Koreksi membuat fisik kurang dari reservasi. Selesaikan alokasi sebelum menyetujui.');assert(lot.qty+c.delta>=0,'Koreksi menyebabkan stok negatif.');lot.qty+=c.delta;movement(s,lot,c.delta,'Koreksi opname',c.id);}
  c.status=type==='approve'?'approved':'rejected';c.approver=actor;c.resolvedAt=new Date().toISOString();log(s,actor,type==='approve'?'Setujui opname':'Tolak opname',c.id+' · delta '+c.delta,c.warehouse);
 }else if(type==='permissions'){
  assert(user(s,actor).owner,'Hanya Owner dapat mengatur wewenang pada prototipe ini.');const target=user(s,p.userId);assert(target&&!target.owner,'Hak Owner tidak dapat diubah.');assert(Array.isArray(p.permissions)&&p.permissions.every(x=>Object.hasOwn(permissions,x)),'Izin tidak valid.');assert(Array.isArray(p.warehouses)&&p.warehouses.length&&p.warehouses.every(x=>warehouses.some(w=>w.id===x)),'Pilih sedikitnya satu gudang.');target.permissions=[...new Set(p.permissions)];target.warehouses=[...new Set(p.warehouses)];log(s,actor,'Atur wewenang',target.name);
 }else throw Error('Tindakan tidak dikenal.');
 return s;
}
export function seed(today=day()){
 const s={version:VERSION,sequence:100,demoDate:today,receipts:[],movements:[],counts:[],audit:[],users:[{id:'owner',name:'Owner Demo',role:'Owner',owner:true,warehouses:warehouses.map(w=>w.id),permissions:Object.keys(permissions)},{id:'gudang',name:'Tim Gudang Demo',role:'Gudang',owner:false,warehouses:['utama'],permissions:['stock.receive','orders.create','orders.process','counts.create']},{id:'auditor',name:'Auditor Demo',role:'Auditor',owner:false,warehouses:['utama','cabang'],permissions:['cost.read']}],products:[],lots:[],orders:[]};
 const data=[['POP-M','Popok bayi ukuran M','popok',85000,62000,30,null],['BOT-240','Botol susu 240 ml','perlengkapan',79000,51000,15,'botol.jpg'],['MPA-OAT','Bubur oat MPASI','mpasi',38000,23000,20,null],['WIP-80','Tisu basah bayi 80 lembar','perawatan',22000,13000,40,null],['SAB-200','Sabun bayi 200 ml','perawatan',45000,28000,15,null],['BRA-01','Bra menyusui','perlengkapan',99000,64000,10,'bra.jpg'],['WAR-01','Penghangat botol','perlengkapan',249000,null,5,'warmer.jpg'],['BOT-LAMA','Botol varian lama','perlengkapan',65000,42000,5,null]];
 for(const [i,d]of data.entries()){const [sku,name,category,price,cost,minimum,image]=d;const id='P'+i;s.products.push({id,sku,name,category,price,cost,minimum,image,created:plus(today,-90)});const c=categories.find(c=>c.id===category);
  for(const w of warehouses){s.lots.push({id:'L'+i+w.id,productId:id,warehouse:w.id,batch:c.batch?'SB-'+(2600+i):'',expiry:c.batch?plus(today,180):null,condition:'saleable',qty:w.id==='utama'?150:50,received:plus(today,-60),reference:'AWAL-'+i+'-'+w.id});}
 }
 s.lots.push({id:'L-near',productId:'P2',warehouse:'utama',batch:'MP-NEAR',expiry:plus(today,45),condition:'saleable',qty:70,received:plus(today,-40),reference:'AWAL-NEAR'});
 s.lots.push({id:'L-expired',productId:'P2',warehouse:'utama',batch:'MP-EXPIRED',expiry:plus(today,-3),condition:'quarantine',qty:6,received:plus(today,-80),reference:'AWAL-EXPIRED'});
 for(let back=6;back>=0;back--)for(let i=0;i<5;i++){
  const date=plus(today,-back),o=reserve(s,'owner',{warehouse:'utama',productId:'P'+i,qty:2+(6-back)+(i%2),reference:`DEMO-${back}-${i}`,customer:'Pelanggan contoh',store:'Official · simulasi'},date);o.status='shipped';o.shipped=date;o.evidence='Data awal demo';for(const a of o.allocations)s.lots.find(l=>l.id===a.lotId).qty-=a.qty;
 }
 for(const [i,status]of ['reserved','picking','packed'].entries()){const o=reserve(s,'owner',{warehouse:'utama',productId:'P'+i,qty:3+i,reference:'SB-10'+i,customer:['Pelanggan A','Pelanggan B','Pelanggan C'][i],store:i===1?'Grosir · simulasi':'Official · simulasi'},today);o.status=status;}
 s.audit=[];return s;
}
export function metrics(s,actor,warehouse='all',today=day()){
 const orders=s.orders.filter(o=>scope(s,actor,o.warehouse)&&(warehouse==='all'||o.warehouse===warehouse));
 const shipped=orders.filter(o=>o.status==='shipped'&&o.shipped===today),revenue=shipped.reduce((n,o)=>n+o.price*o.qty,0),missing=shipped.filter(o=>o.cost===null).length;
 const gross=missing?null:shipped.reduce((n,o)=>n+(o.price-o.cost)*o.qty,0);
 const ranking=s.products.map(p=>{const rows=orders.filter(o=>o.productId===p.id&&o.status==='shipped'&&days(o.shipped,today)>=0&&days(o.shipped,today)<7);return {...p,revenue:rows.reduce((n,o)=>n+o.qty*o.price,0),units:rows.reduce((n,o)=>n+o.qty,0)};}).sort((a,b)=>b.revenue-a.revenue);
 const trend=Array.from({length:7},(_,i)=>{const date=plus(today,i-6);return {date,revenue:orders.filter(o=>o.status==='shipped'&&o.shipped===date).reduce((n,o)=>n+o.price*o.qty,0)};});
 return {orders,revenue,gross,missing,ranking,trend,shipped:shipped.length};
}
