if(process.env.VERCEL){
 const express=require('express');
 const path=require('node:path');
 const helmet=require('helmet');
 const app=express();
 const publicDir=path.join(__dirname,'public');
 app.disable('x-powered-by');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:'],objectSrc:["'none'"]}}}));
 app.use('/api',(req,res)=>res.status(503).json({error:'Checkout and order services are temporarily unavailable during database migration.'}));
 app.get('/admin',(req,res)=>res.sendFile(path.join(publicDir,'admin.html')));
 app.get('/track/:token',(req,res)=>res.sendFile(path.join(publicDir,'track.html')));
 app.use(express.static(publicDir,{fallthrough:true,maxAge:'1h'}));
 app.get('*',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
 app.use((err,req,res,next)=>{console.error('Static Vercel handler error:',err.message);res.status(500).send('Page unavailable');});
 module.exports=app;
}else{
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { put: blobPut, del: blobDelete, get: blobGet } = require('@vercel/blob');
const {Pool}=require('pg');
const PgSession=require('connect-pg-simple')(session);

const app = express();
if(process.env.NODE_ENV==='production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32)) throw new Error('Set SESSION_SECRET to a random value of at least 32 characters in production.');
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const useBlobStorage=Boolean(process.env.BLOB_READ_WRITE_TOKEN||(process.env.VERCEL&&process.env.BLOB_STORE_ID&&process.env.VERCEL_OIDC_TOKEN));
if(process.env.VERCEL&&!useBlobStorage)throw new Error('Vercel evidence storage requires a connected Blob store with VERCEL_OIDC_TOKEN and BLOB_STORE_ID, or BLOB_READ_WRITE_TOKEN.');
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'private_uploads'));
if(!useBlobStorage)fs.mkdirSync(uploadDir, { recursive: true });
if(process.env.VERCEL)throw new Error('Vercel deployment is blocked until the synchronous SQLite data layer and SQLite session store are migrated to PostgreSQL.');
const db = new Database(process.env.DB_PATH || path.join(ROOT, 'store.sqlite'));
const sessionPgPool=process.env.DATABASE_URL||process.env.POSTGRES_URL?new Pool({connectionString:process.env.DATABASE_URL||process.env.POSTGRES_URL,ssl:{rejectUnauthorized:false},max:3,connectionTimeoutMillis:10000}):null;
const durableSessionStore=sessionPgPool?new PgSession({pool:sessionPgPool,createTableIfMissing:true}):new SQLiteStore({db:'sessions.sqlite',dir:path.dirname(process.env.DB_PATH||path.join(ROOT,'store.sqlite'))});
if(db){db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');}
db.exec(`
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS packages(id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0), description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL, alternative_phone TEXT DEFAULT '', email TEXT DEFAULT '', whatsapp_phone TEXT NOT NULL DEFAULT '', whatsapp_opt_in INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS providers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, classification TEXT NOT NULL, coverage TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', fee_type TEXT NOT NULL DEFAULT 'quote', fee INTEGER, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS payment_methods(id INTEGER PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', recipient TEXT NOT NULL DEFAULT '', account_details TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', reference_required INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, tracking_token TEXT UNIQUE NOT NULL, idempotency_key TEXT UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id), package_id INTEGER NOT NULL REFERENCES packages(id), package_name TEXT NOT NULL, package_price INTEGER NOT NULL, destination_type TEXT NOT NULL, country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', district_city TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', delivery_method TEXT NOT NULL, provider_id INTEGER REFERENCES providers(id), provider_name TEXT NOT NULL DEFAULT '', delivery_fee INTEGER, pickup_self INTEGER, collector_name TEXT NOT NULL DEFAULT '', collector_phone TEXT NOT NULL DEFAULT '', payment_method_id INTEGER REFERENCES payment_methods(id), payment_method_name TEXT NOT NULL DEFAULT '', payment_status TEXT NOT NULL DEFAULT 'Awaiting Payment', order_status TEXT NOT NULL DEFAULT 'New', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payment_evidence(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), payer_name TEXT NOT NULL, payer_phone TEXT NOT NULL, transaction_reference TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL, mime_type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_history(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), admin_id INTEGER REFERENCES admins(id), event_type TEXT NOT NULL, old_value TEXT NOT NULL DEFAULT '', new_value TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notification_history(id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), channel TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS regions(id INTEGER PRIMARY KEY, country_code TEXT NOT NULL DEFAULT 'TZ', name TEXT NOT NULL, UNIQUE(country_code,name));
CREATE TABLE IF NOT EXISTS districts(id INTEGER PRIMARY KEY, region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE, name TEXT NOT NULL, UNIQUE(region_id,name));
`);
const customerColumns=db.prepare('PRAGMA table_info(customers)').all().map(c=>c.name);
if(!customerColumns.includes('whatsapp_phone'))db.exec("ALTER TABLE customers ADD COLUMN whatsapp_phone TEXT NOT NULL DEFAULT ''");
if(!customerColumns.includes('whatsapp_opt_in'))db.exec('ALTER TABLE customers ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
const seedPackages = [
  ['full', 'FULL PACKAGE', 489000], ['nusu', 'NUSU PACKAGE', 244500], ['robo', 'ROBO PACKAGE', 122500]
];
const addPackage = db.prepare('INSERT OR IGNORE INTO packages(slug,name,price) VALUES(?,?,?)');
seedPackages.forEach(p => addPackage.run(...p));
const addSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
for (const [k,v] of Object.entries({business_name:'AgizaFlow',brand_color:'#176b57',hero_image:'',logo_url:'',contact_phone:'',pickup_instructions:'Contact the seller for private pickup instructions.',whatsapp_number:'',meta_pixel_id:'',analytics_id:'',currency:'TZS',default_country:'TZ'})) addSetting.run(k,v);
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && !db.prepare('SELECT id FROM admins LIMIT 1').get()) {
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(process.env.ADMIN_USERNAME, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12));
  console.log('Initial admin account created from environment.');
}

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"], imgSrc:["'self'",'data:','https:'], connectSrc:["'self'"], objectSrc:["'none'"], upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null } } }));
app.use(express.json({limit:'100kb'}));
app.use(express.urlencoded({extended:false,limit:'100kb'}));
app.use(session({ store:durableSessionStore, secret:process.env.SESSION_SECRET || 'local-development-secret-change-before-deploying-please', resave:false, saveUninitialized:false, cookie:{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000} }));
app.use('/api', rateLimit({windowMs:15*60*1000,limit:500,standardHeaders:true,legacyHeaders:false}));
const csrf = (req,res,next) => { if(req.session.admin && req.method!=='GET' && req.method!=='HEAD' && req.get('x-csrf-token')!==req.session.csrf) return res.status(403).json({error:'Session token invalid. Reload the admin page.'}); next(); };
app.use('/api',csrf);
const auth = (req,res,next) => req.session.admin ? next() : res.status(401).json({error:'Admin sign-in required'});
const clean = (v,max=500) => sanitizeHtml(String(v ?? '').trim(),{allowedTags:[],allowedAttributes:{}}).slice(0,max);
const setting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '';
const setSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const idemColumn = db.prepare("PRAGMA table_info(orders)").all().some(c=>c.name==='idempotency_key');
if(!idemColumn) db.exec('ALTER TABLE orders ADD COLUMN idempotency_key TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_unique ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL');
const upload = multer({storage:useBlobStorage?multer.memoryStorage():multer.diskStorage({destination:uploadDir,filename:(req,file,cb)=>cb(null,crypto.randomBytes(24).toString('hex')+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype))});
async function saveEvidenceFile(file,orderId){if(useBlobStorage){const result=await blobPut(`payment-evidence/${orderId}/${crypto.randomBytes(24).toString('hex')}${path.extname(file.originalname).toLowerCase()}`,file.buffer,{access:'private',contentType:file.mimetype,addRandomSuffix:false,allowOverwrite:false});return {file_name:result.pathname,blob_url:result.url,mime_type:file.mimetype}}return {file_name:file.filename,blob_url:'',mime_type:file.mimetype}}
async function deleteEvidenceFile(fileName){if(useBlobStorage){await blobDelete(fileName);return}try{fs.unlinkSync(path.join(uploadDir,fileName))}catch{}}
async function getEvidenceFile(fileName){if(useBlobStorage){const result=await blobGet(fileName,{access:'private'});if(!result||result.statusCode!==200)return null;const chunks=[];for await(const chunk of result.stream)chunks.push(Buffer.from(chunk));return {body:Buffer.concat(chunks),contentType:result.blob.contentType}}return {path:path.join(uploadDir,fileName)}}

app.get('/api/public', (req,res) => {const branding=Object.fromEntries(db.prepare('SELECT key,value FROM settings WHERE key NOT IN (\'pickup_instructions\')').all().map(x=>[x.key,x.value]));res.json({branding,packages:db.prepare('SELECT id,slug,name,price,description,image_url FROM packages WHERE active=1 ORDER BY id').all(),regions:db.prepare('SELECT id,name FROM regions WHERE country_code=? ORDER BY name').all('TZ'),providers:db.prepare('SELECT id,name,classification,coverage,fee_type,fee FROM providers WHERE enabled=1').all(),paymentMethods:db.prepare('SELECT id,name,provider,recipient,account_details,instructions,reference_required FROM payment_methods WHERE active=1').all()})});
app.get('/api/districts/:regionId',(req,res)=>res.json(db.prepare('SELECT id,name FROM districts WHERE region_id=? ORDER BY name').all(Number(req.params.regionId))));
app.get('/api/countries',(req,res)=>{const {countries}=require('countries-list');res.json(Object.entries(countries).map(([code,c])=>({code,name:c.name})).sort((a,b)=>a.name.localeCompare(b.name)))});
app.post('/api/orders', rateLimit({windowMs:60*60*1000,limit:15}), (req,res)=>{
  const b=req.body||{}; const idem=clean(req.get('Idempotency-Key')||b.idempotencyKey,100);if(idem){const old=db.prepare('SELECT order_number,tracking_token,package_name,package_price,delivery_fee,payment_method_id FROM orders WHERE idempotency_key=?').get(idem);if(old){const payment=db.prepare('SELECT name,provider,recipient,account_details,instructions FROM payment_methods WHERE id=?').get(old.payment_method_id);return res.status(200).json({orderNumber:old.order_number,trackingToken:old.tracking_token,trackingUrl:`/track/${old.tracking_token}`,packageName:old.package_name,packagePrice:old.package_price,deliveryFee:old.delivery_fee,total:old.delivery_fee===null?null:old.package_price+old.delivery_fee,payment})}} const pkg=db.prepare('SELECT * FROM packages WHERE id=? AND active=1').get(Number(b.packageId));
  if(!pkg)return res.status(400).json({error:'Choose an available package.'});
  const name=clean(b.fullName,120), phone=clean(b.phone,40), email=clean(b.email,200), alt=clean(b.alternativePhone,40), whatsappPhone=clean(b.whatsappPhone,40).replace(/[\s().-]/g,'').replace(/^00/,'');
  if(name.length<2||phone.length<5)return res.status(400).json({error:'Enter your full name and a valid phone number.'});
  if(!/^\+?[1-9]\d{7,14}$/.test(whatsappPhone))return res.status(400).json({error:'Enter a valid WhatsApp number with country code, for example +2557XXXXXXXX.'});
  if(b.whatsappOptIn!==true)return res.status(400).json({error:'Consent to WhatsApp order updates is required to receive direct WhatsApp notifications.'});
  const country=clean(b.country,100), region=clean(b.region,100), district=clean(b.district,100), address=clean(b.address,300), dest= b.destinationType==='international'?'international':'tanzania';
  if(!address || (dest==='tanzania' && (!region||!district)) || (dest==='international'&&!country)) return res.status(400).json({error:'Complete the destination and delivery location.'});
  if(dest==='tanzania' && !db.prepare('SELECT d.id FROM districts d JOIN regions r ON d.region_id=r.id WHERE r.country_code=\'TZ\' AND r.name=? AND d.name=?').get(region,district)) return res.status(400).json({error:'Select a verified region and district configured by the administrator.'});
  if(dest==='international'){const {countries}=require('countries-list');if(!Object.values(countries).some(c=>c.name===country))return res.status(400).json({error:'Choose a country from the supported country list.'});}
  const method=b.deliveryMethod==='pickup'?'pickup':'delivery'; let provider=null;
  if(method==='delivery'){provider=db.prepare('SELECT * FROM providers WHERE id=? AND enabled=1').get(Number(b.providerId));if(!provider)return res.status(400).json({error:'Choose an available delivery provider.'});if(dest==='international'&&provider.classification!=='international' || dest==='tanzania'&&provider.classification==='international')return res.status(400).json({error:'That provider does not serve this destination type.'});}
  const payment=db.prepare('SELECT * FROM payment_methods WHERE id=? AND active=1').get(Number(b.paymentMethodId));
  if(!payment)return res.status(400).json({error:'Choose an active payment method.'});
  const pickupSelf=b.pickupWho==='self'?1:0;
  if(method==='pickup'&& !clean(b.pickupLocation,300))return res.status(400).json({error:'Enter the agreed pickup location.'});
  if(method==='pickup'&&pickupSelf===0&&(!clean(b.collectorName,120)||clean(b.collectorPhone,40).length<5))return res.status(400).json({error:'Enter the collector’s full name and phone number.'});
  const fee=method==='delivery'&&provider.fee_type==='fixed'&&Number.isInteger(provider.fee)?provider.fee:null;
  const customer=db.prepare('INSERT INTO customers(full_name,phone,alternative_phone,email,whatsapp_phone,whatsapp_opt_in) VALUES(?,?,?,?,?,?)').run(name,phone,alt,email,whatsappPhone.replace(/^\+/,''),1);
  const orderNo='AF-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();
  const token=crypto.randomBytes(32).toString('hex');
  const order=db.prepare(`INSERT INTO orders(order_number,tracking_token,idempotency_key,customer_id,package_id,package_name,package_price,destination_type,country,region,district_city,address,postal_code,delivery_method,provider_id,provider_name,delivery_fee,pickup_self,collector_name,collector_phone,payment_method_id,payment_method_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderNo,token,idem||null,customer.lastInsertRowid,pkg.id,pkg.name,pkg.price,dest,country,region,method==='pickup'?district:district,address,clean(b.postalCode,30),method,provider?.id||null,provider?.name||'',fee,method==='pickup'?pickupSelf:null,clean(b.collectorName,120),clean(b.collectorPhone,40),payment.id,payment.name);
  db.prepare('INSERT INTO order_history(order_id,event_type,new_value,note) VALUES(?,?,?,?)').run(order.lastInsertRowid,'order_created','New','Customer submitted an order');
  res.status(201).json({orderNumber:orderNo,trackingToken:token,trackingUrl:`/track/${token}`,packageName:pkg.name,packagePrice:pkg.price,deliveryFee:fee,total:fee===null?null:pkg.price+fee,payment:{id:payment.id,name:payment.name,provider:payment.provider,recipient:payment.recipient,accountDetails:payment.account_details,instructions:payment.instructions},pickupInstructions:method==='pickup'?setting('pickup_instructions'):''});
});
app.post('/api/orders/:trackingToken/evidence',upload.single('screenshot'),async(req,res)=>{
 const order=db.prepare('SELECT * FROM orders WHERE tracking_token=?').get(clean(req.params.trackingToken,100));
 if(!order){if(req.file&&req.file.filename)await deleteEvidenceFile(req.file.filename);return res.status(404).json({error:'Order not found.'});}
 if(order.payment_status==='Verified/Paid'){if(req.file&&req.file.filename)await deleteEvidenceFile(req.file.filename);return res.status(409).json({error:'This payment is already verified; contact the seller if you need help.'});}
 if(!req.file)return res.status(400).json({error:'Upload a JPG, PNG, WebP image or PDF up to 5 MB.'});
 const payer=clean(req.body.payerName,120),payerPhone=clean(req.body.payerPhone,40);
 if(!payer||payerPhone.length<5){if(req.file.filename)await deleteEvidenceFile(req.file.filename);return res.status(400).json({error:'Enter payer name and phone.'});}
 const previous=db.prepare('SELECT file_name FROM payment_evidence WHERE order_id=?').all(order.id);for(const f of previous)await deleteEvidenceFile(f.file_name);
 db.prepare('DELETE FROM payment_evidence WHERE order_id=?').run(order.id);
 let stored;try{stored=await saveEvidenceFile(req.file,order.id)}catch(error){console.error('Evidence storage failed:',error);return res.status(503).json({error:'Secure evidence storage is unavailable; try again later.'})}
 db.prepare('INSERT INTO payment_evidence(order_id,payer_name,payer_phone,transaction_reference,file_name,mime_type) VALUES(?,?,?,?,?,?)').run(order.id,payer,payerPhone,clean(req.body.transactionReference,100),stored.file_name,stored.mime_type);
 db.prepare('UPDATE orders SET payment_status=? WHERE id=?').run('Awaiting Verification',order.id);
 db.prepare('INSERT INTO order_history(order_id,event_type,old_value,new_value,note) VALUES(?,?,?,?,?)').run(order.id,'payment_status',order.payment_status,'Awaiting Verification','Payment evidence uploaded; not yet verified');
 notifyAdmin(order.id).then(result=>res.json({ok:true,orderNumber:order.order_number,status:'Awaiting Verification',whatsappMode:result.mode,whatsappFallback:result.link||null})).catch(()=>res.json({ok:true,orderNumber:order.order_number,status:'Awaiting Verification',whatsappMode:'unavailable'}));
});
app.get('/api/track/:token',(req,res)=>{const o=db.prepare(`SELECT order_number,package_name,package_price,country,region,district_city,delivery_method,provider_name,delivery_fee,payment_status,order_status,created_at FROM orders WHERE tracking_token=?`).get(req.params.token);if(!o)return res.status(404).json({error:'Tracking reference not found.'});res.json(o)});

async function notifyAdmin(orderId){
 const o=db.prepare(`SELECT o.*,c.full_name,c.phone,p.payer_name,p.payer_phone,p.transaction_reference FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN payment_evidence p ON p.order_id=o.id WHERE o.id=?`).get(orderId);
 const msg=`NEW ${setting('business_name')||'BUSINESS'} ORDER\nOrder: ${o.order_number}\nCustomer: ${o.full_name}\nPhone: ${o.phone}\nPackage: ${o.package_name}\nPrice: TZS ${o.package_price}\nPayment: ${o.payment_method_name}\nPayer: ${o.payer_name||'Not submitted'}\nReference: ${o.transaction_reference||'Not provided'}\nFulfilment: ${o.delivery_method}\nDestination: ${[o.region,o.district_city,o.country].filter(Boolean).join(', ')}\nProvider: ${o.provider_name||'Pickup'}\nPAYMENT AWAITING VERIFICATION.`;
 const phone=process.env.WHATSAPP_PHONE_NUMBER_ID,token=process.env.WHATSAPP_ACCESS_TOKEN,to=setting('whatsapp_number').replace(/\D/g,'');
 if(phone&&token&&to){try{const version=process.env.WHATSAPP_API_VERSION||'v21.0';const r=await fetch(`https://graph.facebook.com/${version}/${phone}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:msg}})});const body=await r.text();db.prepare('INSERT INTO notification_history(order_id,channel,outcome,detail) VALUES(?,?,?,?)').run(orderId,'whatsapp_cloud',r.ok?'accepted':'failed',body.slice(0,1000));if(r.ok)return {mode:'api'};}catch(e){db.prepare('INSERT INTO notification_history(order_id,channel,outcome,detail) VALUES(?,?,?,?)').run(orderId,'whatsapp_cloud','failed',String(e).slice(0,500));}}
 db.prepare('INSERT INTO notification_history(order_id,channel,outcome,detail) VALUES(?,?,?,?)').run(orderId,'whatsapp_click_to_chat','manual_fallback','API not configured or unavailable');
 return {mode:'manual_fallback',link:to?`https://wa.me/${to}?text=${encodeURIComponent(msg)}`:null};
}

async function dispatchCustomerNotification(orderId,event,rejectionReason=''){
 const o=db.prepare(`SELECT o.order_number,o.package_name,o.payment_status,c.full_name,c.whatsapp_phone,c.whatsapp_opt_in FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).get(orderId);
 if(!o||!o.whatsapp_opt_in||!o.whatsapp_phone){const result={status:'skipped',reason:'customer_not_opted_in_or_number_missing'};db.prepare('INSERT INTO notification_history(order_id,channel,outcome,detail) VALUES(?,?,?,?)').run(orderId,'whatsapp_customer','skipped',JSON.stringify(result));return result}
 const phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID,token=process.env.WHATSAPP_ACCESS_TOKEN,template=event==='approved'?process.env.WHATSAPP_APPROVED_TEMPLATE:process.env.WHATSAPP_REJECTED_TEMPLATE;
 if(!phoneId||!token||!template){const result={status:'not_configured',reason:'WhatsApp Cloud API credentials or approved status template missing'};db.prepare('INSERT INTO notification_history(order_id,channel,outcome,detail) VALUES(?,?,?,?)').run(orderId,'whatsapp_customer','not_configured',JSON.stringify(result));return result}
 const params=[o.full_name,o.order_number,o.package_name];if(event==='rejected')params.push(rejectionReason||'Tafadhali wasiliana na biashara kwa maelezo.');
 const version=process.env.WHATSAPP_API_VERSION||'v21.0',base=(process.env.WHATSAPP_API_BASE_URL||'https://graph.facebook.com').replace(/\/+$/,'');
 try{const response=await fetch(`${base}/${version}/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:o.whatsapp_phone,type:'template',template:{name:template,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE||'en'},components:[{type:'body',parameters:params.map(text=>({type:'text',text:String(text).slice(0,500)}))}]}})});const body=await response.text();let parsed={};try{parsed=JSON.parse(body)}catch{}const status=response.ok&&parsed.messages?.[0]?.id?'accepted':'failed';const result={status,messageId:parsed.messages?.[0]?.id||null,detail:response.ok?'WhatsApp accepted the message for processing':(parsed.error?.message||body.slice(0,500))};db.prepare('INSERT INTO notification_history(order_id,channel,outcome,detail) VALUES(?,?,?,?)').run(orderId,'whatsapp_customer',status,JSON.stringify(result));return result}catch(error){const result={status:'failed',detail:String(error).slice(0,500)};db.prepare('INSERT INTO notification_history(order_id,channel,outcome,detail) VALUES(?,?,?,?)').run(orderId,'whatsapp_customer','failed',JSON.stringify(result));return result}
}

app.post('/api/admin/login',rateLimit({windowMs:15*60*1000,limit:8}),async(req,res)=>{const a=db.prepare('SELECT * FROM admins WHERE username=?').get(clean(req.body.username,100));if(!a||!await bcrypt.compare(String(req.body.password||''),a.password_hash))return res.status(401).json({error:'Invalid credentials.'});req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Unable to create session.'});req.session.admin={id:a.id,username:a.username};req.session.csrf=crypto.randomBytes(24).toString('hex');res.json({ok:true,username:a.username,csrf:req.session.csrf});});});
app.post('/api/admin/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',auth,(req,res)=>res.json({username:req.session.admin.username,csrf:req.session.csrf}));
app.get('/api/admin/overview',auth,(req,res)=>{const counts=db.prepare(`SELECT payment_status,order_status,COUNT(*) count FROM orders GROUP BY payment_status,order_status`).all();const revenue=db.prepare("SELECT COALESCE(SUM(package_price+COALESCE(delivery_fee,0)),0) total FROM orders WHERE payment_status='Verified/Paid'").get().total;res.json({counts,revenue,orders:db.prepare(`SELECT o.*,c.full_name,c.phone FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC LIMIT 300`).all()})});
app.get('/api/admin/orders/:id',auth,(req,res)=>{const o=db.prepare(`SELECT o.*,c.full_name,c.phone,c.whatsapp_phone,c.alternative_phone,c.email FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).get(Number(req.params.id));if(!o)return res.status(404).json({error:'Order not found'});res.json({order:o,evidence:db.prepare('SELECT id,payer_name,payer_phone,transaction_reference,mime_type,created_at FROM payment_evidence WHERE order_id=? ORDER BY id DESC LIMIT 1').get(o.id)||null,history:db.prepare('SELECT * FROM order_history WHERE order_id=? ORDER BY id DESC').all(o.id)})});
app.get('/api/admin/evidence/:id',auth,async(req,res)=>{const f=db.prepare('SELECT file_name,mime_type FROM payment_evidence WHERE id=?').get(Number(req.params.id));if(!f)return res.sendStatus(404);try{const stored=await getEvidenceFile(f.file_name);if(!stored)return res.sendStatus(404);res.type(stored.contentType||f.mime_type);if(stored.body)return res.send(stored.body);res.sendFile(stored.path)}catch(error){console.error('Evidence retrieval failed:',error);res.sendStatus(503)}});
app.post('/api/admin/orders/:id/action',auth,async(req,res)=>{const o=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));if(!o)return res.status(404).json({error:'Order not found'});const action=clean(req.body.action,40),note=clean(req.body.note,500);let old='',next='';if(action==='approve'){if(!db.prepare('SELECT id FROM payment_evidence WHERE order_id=?').get(o.id))return res.status(400).json({error:'Payment evidence is required before approval.'});if(o.payment_status==='Verified/Paid')return res.status(409).json({error:'Payment is already verified.'});old=o.payment_status;next='Verified/Paid';db.prepare("UPDATE orders SET payment_status='Verified/Paid',order_status=CASE WHEN order_status='New' THEN 'Confirmed' ELSE order_status END WHERE id=?").run(o.id);}else if(action==='reject'){if(!note)return res.status(400).json({error:'A rejection reason is required.'});if(o.payment_status==='Verified/Paid')return res.status(409).json({error:'A verified payment cannot be rejected. Record a refund separately.'});if(o.payment_status==='Rejected')return res.status(409).json({error:'This payment has already been rejected.'});old=o.payment_status;next='Rejected';db.prepare("UPDATE orders SET payment_status='Rejected' WHERE id=?").run(o.id);}else if(action==='request_info'){if(!note)return res.status(400).json({error:'Specify the information required.'});old=o.payment_status;next='Awaiting Verification';}else if(action==='order_status'){const allowed=['New','Confirmed','Processing','Ready for Pickup','Out for Delivery','Delivered','Cancelled'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Invalid order status.'});old=o.order_status;next=req.body.status;db.prepare('UPDATE orders SET order_status=? WHERE id=?').run(next,o.id);}else return res.status(400).json({error:'Unknown action'});db.prepare('INSERT INTO order_history(order_id,admin_id,event_type,old_value,new_value,note) VALUES(?,?,?,?,?,?)').run(o.id,req.session.admin.id,action,old,next,note);if(action==='approve'||action==='reject'){const notification=await dispatchCustomerNotification(o.id,action==='approve'?'approved':'rejected',note);return res.json({ok:true,status:next,notification})}res.json({ok:true,status:next})});
app.get('/api/admin/config',auth,(req,res)=>res.json({settings:Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value])),packages:db.prepare('SELECT * FROM packages ORDER BY id').all(),providers:db.prepare('SELECT * FROM providers ORDER BY id DESC').all(),payments:db.prepare('SELECT * FROM payment_methods ORDER BY id DESC').all(),regions:db.prepare('SELECT r.id,r.name,d.id district_id,d.name district FROM regions r LEFT JOIN districts d ON d.region_id=r.id WHERE r.country_code=\'TZ\' ORDER BY r.name,d.name').all()}));
app.put('/api/admin/packages/:id',auth,(req,res)=>{const name=clean(req.body.name,80),price=Number(req.body.price),description=clean(req.body.description,1500),image=clean(req.body.imageUrl,500);if(!name||!Number.isSafeInteger(price)||price<0)return res.status(400).json({error:'Valid package name and whole-number price required.'});db.prepare('UPDATE packages SET name=?,price=?,description=?,image_url=?,active=? WHERE id=?').run(name,price,description,image,req.body.active===false?0:1,Number(req.params.id));res.json({ok:true})});
app.put('/api/admin/settings',auth,(req,res)=>{const allowed=['business_name','brand_color','hero_image','logo_url','contact_phone','pickup_instructions','whatsapp_number','meta_pixel_id','analytics_id'];for(const k of allowed)if(req.body[k]!==undefined)setSetting.run(k,clean(req.body[k],k==='pickup_instructions'?2000:500));res.json({ok:true})});
app.post('/api/admin/providers',auth,(req,res)=>{const b=req.body;if(!clean(b.name,120))return res.status(400).json({error:'Provider name required.'});const feeType=b.feeType==='fixed'?'fixed':'quote',fee=feeType==='fixed'?Number(b.fee):null;if(feeType==='fixed'&&(!Number.isSafeInteger(fee)||fee<0))return res.status(400).json({error:'Enter a valid delivery fee.'});db.prepare('INSERT INTO providers(name,classification,coverage,contact,fee_type,fee,enabled) VALUES(?,?,?,?,?,?,?)').run(clean(b.name,120),b.classification==='international'?'international':'domestic',clean(b.coverage,500),clean(b.contact,200),feeType,fee,b.enabled===false?0:1);res.json({ok:true})});
app.put('/api/admin/providers/:id',auth,(req,res)=>{const b=req.body;db.prepare('UPDATE providers SET name=?,classification=?,coverage=?,contact=?,fee_type=?,fee=?,enabled=? WHERE id=?').run(clean(b.name,120),b.classification==='international'?'international':'domestic',clean(b.coverage,500),clean(b.contact,200),b.feeType==='fixed'?'fixed':'quote',b.feeType==='fixed'?Number(b.fee):null,b.enabled===false?0:1,Number(req.params.id));res.json({ok:true})});
app.put('/api/admin/payments/:id',auth,(req,res)=>{const b=req.body;db.prepare('UPDATE payment_methods SET name=?,provider=?,recipient=?,account_details=?,instructions=?,reference_required=?,active=? WHERE id=?').run(clean(b.name,100),clean(b.provider,100),clean(b.recipient,120),clean(b.accountDetails,500),clean(b.instructions,1000),b.referenceRequired?1:0,b.active===false?0:1,Number(req.params.id));res.json({ok:true})});
app.post('/api/admin/payments',auth,(req,res)=>{const b=req.body;if(!clean(b.name,100))return res.status(400).json({error:'Payment method name required.'});db.prepare('INSERT INTO payment_methods(name,provider,recipient,account_details,instructions,reference_required,active) VALUES(?,?,?,?,?,?,?)').run(clean(b.name,100),clean(b.provider,100),clean(b.recipient,120),clean(b.accountDetails,500),clean(b.instructions,1000),b.referenceRequired?1:0,b.active===false?0:1);res.json({ok:true})});
app.post('/api/admin/regions',auth,(req,res)=>{const name=clean(req.body.name,100),districts=Array.isArray(req.body.districts)?req.body.districts.map(x=>clean(x,100)).filter(Boolean):[];if(!name)return res.status(400).json({error:'Region name required.'});const tx=db.transaction(()=>{const x=db.prepare('INSERT INTO regions(country_code,name) VALUES(?,?)').run('TZ',name);for(const d of districts)db.prepare('INSERT INTO districts(region_id,name) VALUES(?,?)').run(x.lastInsertRowid,d)});try{tx();res.json({ok:true})}catch(e){res.status(400).json({error:'Region already exists or data invalid.'})}});
app.post('/api/admin/districts',auth,(req,res)=>{try{db.prepare('INSERT INTO districts(region_id,name) VALUES(?,?)').run(Number(req.body.regionId),clean(req.body.name,100));res.json({ok:true})}catch{res.status(400).json({error:'District already exists or region invalid.'})}});
app.get('/p/:slug',(req,res)=>{const p=db.prepare('SELECT * FROM packages WHERE slug=? AND active=1').get(clean(req.params.slug,60));if(!p)return res.sendStatus(404);let html=fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8');const title=`${p.name} | ${setting('business_name')||'AgizaFlow'}`;const desc=p.description||`Agiza ${p.name} kwa ${p.price} TZS.`;html=html.replace('<title>AgizaFlow | Agiza sasa</title>',`<title>${clean(title,160)}</title>`).replace('<meta property="og:title" content="AgizaFlow | Agiza sasa">',`<meta property="og:title" content="${clean(title,160)}">`).replace('<meta property="og:description" content="Chagua kifurushi kinachokufaa.">',`<meta property="og:description" content="${clean(desc,300)}">`).replace('<meta property="og:image" content="">',`<meta property="og:image" content="${clean(p.image_url,500)}">`).replace('<script src="/app.js" defer></script>',`<script src="/app.js" defer></script>`).replace('<meta property="og:type" content="product">',`<meta name="product-slug" content="${clean(p.slug,60)}"><meta property="og:type" content="product">`);res.type('html').send(html)});
app.get('/admin',(req,res)=>res.sendFile(path.join(ROOT,'public/admin.html')));
app.get('/track/:token',(req,res)=>res.sendFile(path.join(ROOT,'public/track.html')));
app.use(express.static(path.join(ROOT,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public/index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(err instanceof multer.MulterError?400:500).json({error:err instanceof multer.MulterError?'Upload exceeds limits or is invalid.':'Server error.'})});
if(!process.env.VERCEL)app.listen(PORT,()=>console.log(`AgizaFlow listening on port ${PORT}`));
module.exports=app;
}
