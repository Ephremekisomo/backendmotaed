const { Pool } = require('pg')
const p = new Pool({
  connectionString: 'postgresql://postgres.jnoqtchsrartktaxwcdu:Ephreme0977@aws-1-eu-west-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
})

p.query('SELECT id, full_name, email, role, status FROM public.users WHERE email = $1', ['admin@motaed.cd'])
  .then(r => {
    console.log('public.users rows:', r.rows.length)
    console.log(r.rows)
    return p.query('SELECT id, email, role, email_confirmed_at IS NOT NULL AS confirmed, LEFT(encrypted_password, 30) AS pw_prefix FROM auth.users WHERE email = $1', ['admin@motaed.cd'])
  })
  .then(r2 => {
    console.log('auth.users rows:', r2.rows.length)
    console.log(r2.rows)
    return p.end()
  })
  .catch(e => {
    console.error('DB ERR:', e.message)
    process.exit(1)
  })
