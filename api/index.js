// Vercel entrypoint deliberately fails closed: routes remain SQLite-backed.
if(process.env.VERCEL){
  if(!(process.env.BLOB_READ_WRITE_TOKEN||(process.env.BLOB_STORE_ID&&process.env.VERCEL_OIDC_TOKEN)))throw new Error('Connect the private Blob store using OIDC or provide BLOB_READ_WRITE_TOKEN.');
  if(!(process.env.DATABASE_URL||process.env.POSTGRES_URL))throw new Error('Connect Neon and configure DATABASE_URL before deploying.');
  throw new Error('Vercel deployment is disabled until all SQLite route queries are migrated to PostgreSQL and tested.');
}
module.exports=require('../server');
