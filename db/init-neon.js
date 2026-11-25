// Initialize only the durable Neon schema. Requires DATABASE_URL or POSTGRES_URL.
// Never logs credentials, customer data, or query results.
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const url=process.env.DATABASE_URL||process.env.POSTGRES_URL;
if(!url)throw new Error('DATABASE_URL is required; load the Vercel environment first.');
const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:30000});
(async()=>{try{const schema=fs.readFileSync(path.join(__dirname,'schema.postgres.sql'),'utf8').replace(/^\\s*--.*$/gm,'');const statements=schema.split(';').map(s=>s.trim()).filter(Boolean);for(const statement of statements)await pool.query(statement);await pool.query("INSERT INTO packages(slug,name,price) VALUES ('full','FULL PACKAGE',489000),('nusu','NUSU PACKAGE',244500),('robo','ROBO PACKAGE',122500) ON CONFLICT (slug) DO NOTHING");console.log('Neon schema initialized and default packages seeded.');}catch(error){console.error('Neon initialization failed:',error.code||error.message);process.exitCode=1}finally{await pool.end()}})();
