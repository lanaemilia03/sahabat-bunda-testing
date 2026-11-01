import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,apply,stock,reserved,eligible,position,metrics} from './domain.mjs';
const today='2026-11-01',fresh=()=>seed(today);
const order=(s,extra={})=>apply(s,'owner','order',{reference:'TEST-ORDER',customer:'Demo',store:'Toko contoh',warehouse:'utama',productId:'P0',qty:2,...extra},today);
const step=(s,id,next)=>apply(s,'owner','transition',{id,next,evidence:'Kurir DEMO'},today);
test('reservation, pick, pack, handoff conserve physical and available',()=>{
 let s=fresh(),before=stock(s,'owner','utama','P0',today);s=order(s);const id=s.orders[0].id;
 assert.equal(stock(s,'owner','utama','P0',today).physical,before.physical);
 assert.equal(stock(s,'owner','utama','P0',today).available,before.available-2);
 s=step(s,id,'picking');s=step(s,id,'packed');assert.equal(stock(s,'owner','utama','P0',today).physical,before.physical);
 s=step(s,id,'shipped');assert.equal(stock(s,'owner','utama','P0',today).physical,before.physical-2);assert.equal(stock(s,'owner','utama','P0',today).available,before.available-2);
 assert.throws(()=>step(s,id,'shipped'),/Status sudah berubah/);
});
test('shortage and duplicate orders do not modify original state',()=>{
 const s=fresh(),before=JSON.stringify(s);assert.throws(()=>order(s,{qty:999999}),/tidak mencukupi/);assert.equal(JSON.stringify(s),before);
 const a=order(s);assert.throws(()=>order(a),/sudah digunakan/);
});
test('last available unit cannot be allocated twice in sequential demo commands',()=>{
 let s=fresh(),q=stock(s,'owner','utama','P0',today).available;s=order(s,{qty:q});assert.throws(()=>order(s,{reference:'SECOND',qty:1}),/tidak mencukupi/);
});
test('cancellation after picking requires physical restock before release',()=>{
 let s=fresh(),n=stock(s,'owner','utama','P0',today).available;s=order(s);const id=s.orders[0].id;s=step(s,id,'picking');s=step(s,id,'cancel_pending');assert.equal(stock(s,'owner','utama','P0',today).available,n-2);s=step(s,id,'cancelled');assert.equal(stock(s,'owner','utama','P0',today).available,n);
});
test('FEFO chooses earliest eligible batch and never expired lot',()=>{
 const s=order(fresh(),{productId:'P2',qty:2});assert.equal(s.orders[0].allocations[0].lotId,'L-near');assert(!eligible(s,s.lots.find(l=>l.id==='L-expired'),today));
});
test('expiry is rechecked at picking and handoff',()=>{
 let s=order(fresh(),{productId:'P2',qty:2});const id=s.orders[0].id;
 assert.throws(()=>apply(s,'owner','transition',{id,next:'picking'},'2026-12-01'),/tidak lagi memenuhi/);
});
const receipt={productId:'P2',warehouse:'utama',qty:5,reference:'RCV-TEST',batch:'LOT-TEST',expiry:'2027-03-01',condition:'saleable'};
test('mandatory batch, invalid dates, minimum shelf life and quarantine',()=>{
 const s=fresh();assert.throws(()=>apply(s,'owner','receive',{...receipt,batch:''},today));assert.throws(()=>apply(s,'owner','receive',{...receipt,expiry:'2027-02-30'},today));assert.throws(()=>apply(s,'owner','receive',{...receipt,expiry:'2026-11-10'},today),/umur terlalu pendek/);
 const a=apply(s,'owner','receive',{...receipt,expiry:'2026-10-31',condition:'quarantine'},today);assert.equal(stock(a,'owner','utama','P2',today).available,stock(s,'owner','utama','P2',today).available);assert.equal(stock(a,'owner','utama','P2',today).physical,stock(s,'owner','utama','P2',today).physical+5);
});
test('receipt idempotency guard and integer validation',()=>{
 let s=fresh();assert.throws(()=>apply(s,'owner','receive',{...receipt,qty:1.5},today));s=apply(s,'owner','receive',receipt,today);assert.throws(()=>apply(s,'owner','receive',receipt,today),/sudah diproses/);
});
test('role and warehouse scope apply to commands and stock reads',()=>{
 const s=fresh();assert.throws(()=>apply(s,'auditor','receive',receipt,today),/tidak berwenang/);assert.throws(()=>apply(s,'gudang','receive',{...receipt,warehouse:'cabang'},today),/di luar/);assert.equal(stock(s,'gudang','cabang',null,today).physical,0);
});
test('permission changes take effect and Owner stays protected',()=>{
 let s=fresh();s=apply(s,'owner','permissions',{userId:'gudang',permissions:[],warehouses:['utama']},today);assert.throws(()=>apply(s,'gudang','receive',receipt,today),/tidak berwenang/);assert.throws(()=>apply(s,'owner','permissions',{userId:'owner',permissions:[],warehouses:['utama']},today),/Owner/);assert.throws(()=>apply(s,'gudang','permissions',{userId:'auditor',permissions:['cost.read'],warehouses:['utama']},today),/Hanya Owner/);
});
test('stock count approval applies delta after subsequent movements',()=>{
 let s=fresh(),lot=s.lots.find(l=>l.id==='L0utama');const baseline=lot.qty;
 s=apply(s,'gudang','count',{lotId:lot.id,expected:baseline,counted:baseline-2,reason:'Recount contoh'},today);const countId=s.counts[0].id;
 s=order(s,{qty:3});const orderId=s.orders[0].id;s=step(s,orderId,'picking');s=step(s,orderId,'packed');s=step(s,orderId,'shipped');
 s=apply(s,'owner','approve',{id:countId},today);assert.equal(s.lots.find(l=>l.id===lot.id).qty,baseline-5);assert.throws(()=>apply(s,'owner','approve',{id:countId},today),/sudah diproses/);
});
test('maker checker, stale count, duplicate pending and reservation floor',()=>{
 let s=fresh(),lot=s.lots.find(l=>l.id==='L0utama');assert.throws(()=>apply(s,'gudang','count',{lotId:lot.id,expected:lot.qty+1,counted:0,reason:'Test'},today),/berubah/);
 s=apply(s,'owner','count',{lotId:lot.id,expected:lot.qty,counted:lot.qty,reason:'Test'},today);assert.throws(()=>apply(s,'owner','approve',{id:s.counts[0].id},today),/harus berbeda/);assert.throws(()=>apply(s,'gudang','count',{lotId:lot.id,expected:lot.qty,counted:0,reason:'Test'},today),/Masih ada/);
 s=fresh();lot=s.lots.find(l=>l.id==='L0utama');assert(reserved(s,lot.id)>0);s=apply(s,'gudang','count',{lotId:lot.id,expected:lot.qty,counted:0,reason:'Semua hilang'},today);assert.throws(()=>apply(s,'owner','approve',{id:s.counts[0].id},today),/kurang dari reservasi/);
});
test('missing COGS stays unknown; negative prices and duplicate SKUs rejected',()=>{
 let s=fresh();s=order(s,{productId:'P6'});const id=s.orders[0].id;s=step(s,id,'picking');s=step(s,id,'packed');s=step(s,id,'shipped');assert.equal(metrics(s,'owner','all',today).gross,null);
 const p={sku:'NEW',name:'Test',category:'popok',price:-1,cost:null,minimum:1};assert.throws(()=>apply(s,'owner','product',p,today));assert.throws(()=>apply(s,'owner','product',{...p,sku:'pop-m',price:100},today),/sudah digunakan/);
});
test('positions add to physical and available never counts quarantine',()=>{
 const s=fresh();for(const l of s.lots){const p=position(s,l,today);assert.equal(p.rack+p.picking+p.packed+p.restock,p.physical);assert(p.available>=0);assert(p.reserved<=p.physical);if(l.condition==='quarantine')assert.equal(p.available,0);}
});

test('same batch cannot silently acquire a different expiry',()=>{
 let s=apply(fresh(),'owner','receive',receipt,today);
 assert.throws(()=>apply(s,'owner','receive',{...receipt,reference:'RCV-SECOND',expiry:'2027-04-01'},today),/tanggal expired berbeda/);
});
test('order values outside safe integer precision are rejected',()=>{
 const s=fresh();s.products[0].price=1000000000;
 assert.throws(()=>order(s,{qty:1000000000}),/Nilai pesanan terlalu besar/);
});
const command=(s,type,p)=>apply(s,'owner',type,p,today);
function returning(){let s=order(fresh());const id=s.orders[0].id;for(const next of ['picking','packed','shipped'])s=step(s,id,next);s=command(s,'case_request',{id,kind:'return',qty:2,reason:'Rusak'});s=command(s,'case_decide',{id,decision:'approve',reason:'Disetujui marketplace'});return {s,id};}
test('return transit does not increase stock; partial receipts quarantine once and preserve batch',()=>{
 let {s,id}=returning();const before=stock(s,'owner','utama','P0',today),lotId=s.orders[0].allocations[0].lotId;
 assert.throws(()=>command(s,'return_receive',{id,lotId,qty:1,reference:'R1',note:'Baik'}),/belum dikirim/);
 s=command(s,'return_ship',{id,courier:'JNE',tracking:'BALIK-1',sentDate:today,note:'Dikirim'});assert.equal(stock(s,'owner','utama','P0',today).physical,before.physical);
 s=command(s,'return_receive',{id,lotId,qty:1,reference:'R1',note:'Segel rusak'});assert.equal(s.orders[0].returnCase.status,'partial');assert.equal(stock(s,'owner','utama','P0',today).physical,before.physical+1);assert.equal(stock(s,'owner','utama','P0',today).available,before.available);
 assert.throws(()=>command(s,'return_receive',{id,lotId,qty:1,reference:'R1',note:'Duplikat'}),/sudah diproses/);assert.throws(()=>command(s,'return_receive',{id,lotId,qty:2,reference:'R2',note:'Lebih'}),/melebihi/);
 s=command(s,'return_receive',{id,lotId,qty:1,reference:'R2',note:'Baik'});assert.equal(s.orders[0].returnCase.status,'received');assert.equal(s.lots.at(-1).condition,'quarantine');assert.equal(s.lots.at(-1).batch,s.lots.find(x=>x.id===lotId).batch);
 assert.throws(()=>command(s,'return_receive',{id,lotId,qty:1,reference:'R3',note:'Duplikat'}),/sudah diterima/);
});
test('customer cancellation blocks fulfilment; approval keeps picked stock reserved until restock',()=>{
 let s=order(fresh()),id=s.orders[0].id;s=step(s,id,'picking');const before=stock(s,'owner','utama','P0',today);
 s=command(s,'case_request',{id,kind:'cancel',reason:'Customer batal'});assert.throws(()=>step(s,id,'packed'),/pengajuan pelanggan/);
 s=command(s,'case_decide',{id,decision:'approve',reason:'Customer terkonfirmasi'});assert.equal(s.orders[0].status,'cancel_pending');assert.equal(stock(s,'owner','utama','P0',today).available,before.available);s=step(s,id,'cancelled');assert.equal(stock(s,'owner','utama','P0',today).available,before.available+2);
});
test('refund without goods never adds inventory and return commands enforce permission and scope',()=>{
 let {s,id}=returning();assert.throws(()=>apply(s,'auditor','return_ship',{id},today),/tidak berwenang/);
 s.orders[0].warehouse='cabang';assert.throws(()=>apply(s,'gudang','return_ship',{id},today),/di luar/);
 s=order(fresh());id=s.orders[0].id;for(const next of ['picking','packed','shipped'])s=step(s,id,next);const before=stock(s,'owner','utama','P0',today).physical;
 s=command(s,'case_request',{id,kind:'refund',reason:'Kompensasi'});s=command(s,'case_decide',{id,decision:'approve',reason:'Refund disepakati'});assert.equal(s.orders[0].returnCase.status,'closed');assert.equal(stock(s,'owner','utama','P0',today).physical,before);assert.throws(()=>command(s,'return_ship',{id}),/belum disetujui/);
});
test('printing locks duplicate requests, requires reprint confirmation and blocks cancelled orders',()=>{
 let s=order(fresh(),{courier:'JNE',tracking:'DEMO-1'}),id=s.orders[0].id;s=command(s,'print_request',{id});assert.throws(()=>command(s,'print_request',{id}),/Konfirmasi hasil/);s=command(s,'print_result',{id,result:'printed'});assert.throws(()=>command(s,'print_request',{id}),/Konfirmasi cetak ulang/);s=command(s,'print_request',{id,confirmReprint:true,reason:'Kertas rusak'});s=command(s,'print_result',{id,result:'failed'});s=command(s,'case_request',{id,kind:'cancel',reason:'Batal'});assert.throws(()=>command(s,'print_request',{id,confirmReprint:true,reason:'Coba'}),/diblokir/);
});
