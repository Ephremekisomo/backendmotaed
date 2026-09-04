import 'dotenv/config'

const email = process.argv[2] ?? 'admin@motaed.cd'
const password = process.argv[3] ?? 'Motdepasse2026!'
const fullName = process.argv[4] ?? 'Amadou Mukendi'
const role = (process.argv[5] ?? 'super_admin') as 'super_admin' | 'admin'

const match = process.env.DATABASE_URL?.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/)
if (!match) {
  console.error('Cannot parse DATABASE_URL')
  process.exit(1)
}
const [, projectRef, , host, port, db] = match
const supabaseUrl = `https://${projectRef}.supabase.co`
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is missing in .env')
  console.log('Find it in Supabase > Project Settings > API > service_role')
  process.exit(1)
}

async function adminCreate() {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey as string, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role } }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Auth Admin error ${res.status}: ${txt}`)
  }
  return (await res.json()) as { id: string; email: string }
}

async function pgInsert(id: string) {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  try {
    await pool.query(
      `insert into public.users (id, full_name, email, role, status)
       values ($1, $2, $3, $4, 'actif')
       on conflict (id) do update set
         full_name = excluded.full_name,
         email = excluded.email,
         role = excluded.role,
         status = 'actif'`,
      [id, fullName, email, role]
    )
  } finally {
    await pool.end()
  }
}

async function main() {
  console.log('Supabase URL:', supabaseUrl)
  console.log('Creating user via Auth Admin...')
  const user = await adminCreate()
  console.log('  Auth user id:', user.id)
  console.log('Inserting profile in public.users...')
  await pgInsert(user.id)
  console.log('---')
  console.log('SUPER ADMIN CREE AVEC SUCCES')
  console.log('  ID       :', user.id)
  console.log('  Email    :', email)
  console.log('  Password :', password)
  console.log('  Full name:', fullName)
  console.log('  Role     :', role)
}

void main().catch((err) => {
  console.error('ERROR:', err instanceof Error ? err.message : err)
  process.exit(1)
})
