# AgizaFlow Store

Configurable sales and order-management application built with Express and SQLite.

## Local setup

1. Install Node.js 20+.
2. Run `npm install`.
3. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` in the environment before first launch. Copy `.env.example` to `.env` only if using an environment loader; Node does not load `.env` automatically.
4. Run `npm start` and open `http://localhost:3000`. The admin console is at `/admin`.

## Docker

Copy `.env.example` to `.env`, replace the secrets, then run `docker compose up --build`. The SQLite database and private payment uploads persist in the `store_data` volume. Put the service behind HTTPS for production.

## Vercel storage status

The private Vercel Blob store and Neon PostgreSQL integration are connected to the Vercel project. Blob uses Vercel OIDC through `BLOB_STORE_ID` and `VERCEL_OIDC_TOKEN`; a static `BLOB_READ_WRITE_TOKEN` is optional and is mainly for non-Vercel environments. Run `vercel env pull .env.local` to load development credentials locally; never commit `.env.local`.

Express sessions use PostgreSQL via `connect-pg-simple` when `DATABASE_URL` or `POSTGRES_URL` exists, and SQLite sessions for local test runs without database credentials. `db/schema.postgres.sql` and `npm run db:init` provide the Neon schema setup, but the database could not be reached from this environment during validation. More importantly, application routes still use synchronous SQLite queries. `api/index.js` therefore refuses to serve requests on Vercel until that data-layer migration is completed. Do not remove this guard or enable live orders until routes, schema initialization, session behavior, uploads, and end-to-end tests all pass against PostgreSQL.

## Business setup

Sign in to `/admin`, then configure package descriptions/images, pricing, branding, verified Tanzania regions and districts, delivery providers, pickup instructions, and payment methods. No payment number, transport provider, product packaging, or medical claim is preconfigured. Admin bootstrap credentials are read only on first launch when the admins table is empty.

For automated WhatsApp notifications, configure the official WhatsApp Business Cloud API phone-number ID and access token, plus the business recipient number in Website branding. Configure approved WhatsApp message templates in `WHATSAPP_APPROVED_TEMPLATE`, `WHATSAPP_REJECTED_TEMPLATE`, and `WHATSAPP_TEMPLATE_LANGUAGE`; template bodies must accept parameters in this order: customer name, order number, package name, and (for rejection) reason. Checkout collects a WhatsApp number and explicit consent. On admin approval or rejection, `dispatchCustomerNotification` calls the official API directly for that customer. The dashboard reports whether the API accepted or failed the request; accepted does not mean delivered. Notifications are recorded in `notification_history`. If the API or templates are not configured, the action is still saved and the result is recorded as `not_configured`; no false delivery claim is shown. Uploaded evidence is private and available to authenticated admins only; uploads are not payment confirmation.

Set `SESSION_SECRET` to a unique random value of at least 32 characters, use strong unique admin credentials, configure HTTPS and trusted proxy settings, and back up the persistent volume. Country choices come from the `countries-list` maintained npm dataset. Tanzania administrative regions/districts must be entered from a verified authoritative dataset through the admin tools.
