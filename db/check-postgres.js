// Safe database connectivity/schema probe. Requires DATABASE_URL or POSTGRES_URL.
// It never prints connection strings, database rows, or credentials.
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const connectionString=process.env.DATABASE_URL||process.env.POSTGRES_URL;
if(!connectionString)throw new Error('Load the Vercel project environment first with `vercel env pull .env.local`.');
const pool=new Pool({connectionString,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:30000});
(async()=>{try{await pool.query('BEGIN');const schema=fs.readFileSync(path.join(__dirname,'schema.postgres.sql'),'utf8');await pool.query(schema);await pool.query("INSERT INTO packages(slug,name,price) VALUES ('full','FULL PACKAGE',489000),('nusu','NUSU PACKAGE',244500),('robo','ROBO PACKAGE',122500) ON CONFLICT (slug) DO NOTHING");await pool.query('ROLLBACK');console.log('PostgreSQL connectivity and schema SQL validated; test writes rolled back.');}catch(error){console.error('PostgreSQL validation failed:',error.code||error.message);process.exitCode=1}finally{await pool.end()}})();
