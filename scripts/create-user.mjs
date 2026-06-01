// Creates a confirmed email/password user directly in Supabase auth.
//   EMAIL=a@a.co PASS=123456 DATABASE_URL=... node scripts/create-user.mjs
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const url = process.env.DATABASE_URL
const email = process.env.EMAIL || 'a@a.co'
const pass = process.env.PASS || '123456'
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const uid = randomUUID()

const run = async () => {
  await client.connect()
  // start fresh if it already exists
  await client.query(`delete from auth.users where email = $1`, [email])

  await client.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change)
     values
       ('00000000-0000-0000-0000-000000000000', '${uid}'::uuid, 'authenticated', 'authenticated', $1,
        crypt($2, gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        '', '', '', '')`,
    [email, pass],
  )

  await client.query(
    `insert into auth.identities
       (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
     values
       (gen_random_uuid(), '${uid}'::uuid,
        jsonb_build_object('sub', '${uid}', 'email', $1::text, 'email_verified', true),
        'email', '${uid}', now(), now(), now())`,
    [email],
  )

  await client.end()
  console.log(`Created confirmed user:\n  email: ${email}\n  pass:  ${pass}`)
}
run().catch((e) => { console.error(e.message); process.exit(1) })
