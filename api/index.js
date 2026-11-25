const express=require('express');
const path=require('node:path');

// Safe Vercel fallback while order storage migration is incomplete.
// Static storefront/admin pages render; APIs are deliberately unavailable.
const app=express();
const publicDir=path.join(__dirname,'..','public');
app.disable('x-powered-by');
app.use('/api',(req,res)=>res.status(503).json({error:'Order services are temporarily unavailable while durable database migration is completed.'}));
app.get('/admin',(req,res)=>res.sendFile(path.join(publicDir,'admin.html')));
app.get('/track/:token',(req,res)=>res.sendFile(path.join(publicDir,'track.html')));
app.get('/p/:slug',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.use(express.static(publicDir,{fallthrough:true,maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.get('*',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.use((err,req,res,next)=>{console.error('Vercel static handler error:',err.message);res.status(500).send('Page unavailable');});
module.exports=app;
