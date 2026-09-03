import 'dotenv/config'
import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import crypto from 'crypto'

const app = express()
const port = Number(process.env.PORT ?? 10000)
const jwtSecret = process.env.JWT_SECRET
if (!process.env.DATABASE_URL || !jwtSecret) throw new Error('DATABASE_URL et JWT_SECRET sont obligatoires')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 10 })
app.use(helmet())
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5174', credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true }))

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Backend Motards API fonctionne correctement 🚀',
    status: 'online'
  })
})

type AuthRequest = Request & { user?: { id: string; role: string } }
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) })
const riderSchema = z.object({ firstName: z.string().min(1), lastName: z.string().min(1), type: z.enum(['Motard', 'Taxi', 'Taxi-bus', 'Autre']).default('Motard'), phone: z.string().optional(), plate: z.string().optional(), zone: z.string().optional() })

function tokenFor(user: { id: string; role: string }) { return jwt.sign(user, jwtSecret as string, { expiresIn: '8h' }) }
function requireAuth(req: AuthRequest, res: Response, next: NextFunction) { const token = req.cookies?.motaed_session ?? req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ error: 'Authentification requise' }); try { req.user = jwt.verify(token, jwtSecret as string) as AuthRequest['user']; next() } catch { return res.status(401).json({ error: 'Session expirée' }) } }

app.get('/api/health', async (_req, res) => { try { await pool.query('select 1'); res.json({ ok: true, database: 'connected' }) } catch { res.status(503).json({ ok: false, database: 'unavailable' }) } })
app.post('/api/auth/login', async (req, res, next) => { try { const input = loginSchema.parse(req.body); const result = await pool.query('select p.id, p.role, p.status, a.encrypted_password as password_hash from public.users p join auth.users a on a.id = p.id where lower(p.email) = lower($1) limit 1', [input.email]); const user = result.rows[0]; if (!user || user.status !== 'actif' || !user.password_hash || !(await bcrypt.compare(input.password, user.password_hash))) return res.status(401).json({ error: 'Identifiants incorrects' }); res.cookie('motaed_session', tokenFor({ id: user.id, role: user.role }), { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }); res.json({ user: { id: user.id, role: user.role } }) } catch (error) { next(error) } })
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('motaed_session', { sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production' }); res.status(204).send() })
app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res, next) => { try { const result = await pool.query('select id, full_name, email, role, status from public.users where id = $1 limit 1', [req.user?.id]); res.json({ user: req.user, profile: result.rows[0] ?? null }) } catch (error) { next(error) } })

app.get('/api/riders', requireAuth, async (req, res, next) => { try { const search = String(req.query.search ?? ''); const status = String(req.query.status ?? ''); const result = await pool.query(`select id, first_name, last_name, driver_type, identification_number, plate_number, activity_zone, status, created_at from public.riders where ($1 = '' or concat_ws(' ', first_name, last_name, identification_number, plate_number) ilike '%' || $1 || '%') and ($2 = '' or status::text = $2) order by created_at desc limit 100`, [search, status]); res.json(result.rows) } catch (error) { next(error) } })
app.post('/api/riders', requireAuth, async (req: AuthRequest, res, next) => { try { const input = riderSchema.parse(req.body); const driverType = { Motard: 'motard', Taxi: 'chauffeur_taxi', 'Taxi-bus': 'chauffeur_taxi_bus', Autre: 'autre' }[input.type]; const result = await pool.query(`insert into public.riders (first_name, last_name, phone, driver_type, identification_number, plate_number, activity_zone, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, unique_code, first_name, last_name, driver_type, identification_number, plate_number, activity_zone, status, created_at`, [input.firstName, input.lastName, input.phone || null, driverType, `${driverType === 'motard' ? 'MOT' : 'PRO'}-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`, input.plate || null, input.zone || null, req.user?.id]); const publicQrUrl = `${process.env.FRONTEND_URL ?? 'https://fontmotaed.vercel.app'}/verify/${result.rows[0].unique_code}`; await pool.query('update public.qr_codes set qr_url = $1 where rider_id = $2', [publicQrUrl, result.rows[0].id]); res.status(201).json({ ...result.rows[0], qr_url: publicQrUrl, plate_number: input.plate ?? null }) } catch (error) { next(error) } })
app.get('/api/verify/:token', async (req, res, next) => { try { const idResult = await pool.query('select public.verify_identification($1) as payload', [req.params.token]); const idPayload = idResult.rows[0]?.payload; if (idPayload && idPayload.success !== false) return res.json(idPayload); const riderResult = await pool.query('select * from public.verify_rider($1)', [req.params.token]); if (!riderResult.rows[0]) return res.status(404).json({ success: false, error: 'QR Code non reconnu' }); res.json({ success: true, legacy: riderResult.rows[0] }) } catch (error) { next(error) } })
app.get('/api/stats', requireAuth, async (_req, res, next) => { try { const riders = await pool.query("select count(*) as total, count(*) filter (where status = 'actif') as active from public.riders"); const qr = await pool.query('select count(*) as total from public.qr_codes'); const verifications = await pool.query('select count(*) as total from public.verification_logs'); res.json({ riders: Number(riders.rows[0].total), activeRiders: Number(riders.rows[0].active), qrCodes: Number(qr.rows[0].total), verifications: Number(verifications.rows[0].total) }) } catch (error) { next(error) } })
app.get('/api/stats/chart', requireAuth, async (_req, res, next) => { try { const result = await pool.query(`select to_char(verified_at, 'Dy') as day, count(*) as count from public.verification_logs where verified_at >= now() - interval '7 days' group by 1 order by min(verified_at)`); const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']; const map = Object.fromEntries(result.rows.map((r) => [r.day, Number(r.count)])); res.json(days.map((day) => ({ day, count: map[day] ?? 0 }))) } catch (error) { next(error) } })
app.patch('/api/riders/:id/status', requireAuth, async (req: AuthRequest, res, next) => { try { const { status } = req.body as { status: string }; if (!['actif', 'suspendu', 'expire', 'desactive'].includes(status)) return res.status(400).json({ error: 'Statut invalide' }); const result = await pool.query('update public.riders set status = $1, updated_at = now() where id = $2 returning id, status', [status, req.params.id]); if (!result.rows[0]) return res.status(404).json({ error: 'Profil introuvable' }); res.json(result.rows[0]) } catch (error) { next(error) } })
app.delete('/api/riders/:id', requireAuth, async (req: AuthRequest, res, next) => { try { const result = await pool.query('delete from public.riders where id = $1 returning id', [req.params.id]); if (!result.rows[0]) return res.status(404).json({ error: 'Profil introuvable' }); res.status(204).send() } catch (error) { next(error) } })
app.post('/api/riders/:id/photo', requireAuth, async (req: AuthRequest, res, next) => { try { const { photo_url } = req.body as { photo_url?: string }; const result = await pool.query('update public.riders set photo_url = $1, updated_at = now() where id = $2 returning id, photo_url', [photo_url ?? null, req.params.id]); if (!result.rows[0]) return res.status(404).json({ error: 'Profil introuvable' }); res.json(result.rows[0]) } catch (error) { next(error) } })
app.get('/api/users', requireAuth, async (_req, res, next) => { try { const result = await pool.query('select id, full_name, email, role, status, created_at from public.users order by created_at desc'); res.json(result.rows) } catch (error) { next(error) } })
app.post('/api/users', requireAuth, async (req: AuthRequest, res, next) => { try { const input = z.object({ email: z.string().email(), password: z.string().min(8), fullName: z.string().min(1), role: z.enum(['super_admin', 'admin']) }).parse(req.body); const id = crypto.randomUUID(); const hash = await bcrypt.hash(input.password, 10); await pool.query('insert into auth.users (id, email, encrypted_password, aud, role) values ($1, $2, $3, $4, $5)', [id, input.email, hash, 'authenticated', 'authenticated']); await pool.query('insert into public.users (id, full_name, email, role) values ($1, $2, $3, $4)', [id, input.fullName, input.email, input.role]); res.status(201).json({ id, full_name: input.fullName, email: input.email, role: input.role }) } catch (error) { next(error) } })

// =====================================================
// Identification sheets (fiche d'identification officielle)
// =====================================================
const ownerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  middle_name: z.string().optional(),
  date_of_birth: z.string().optional(),
  place_of_birth: z.string().optional(),
  gender: z.enum(['M', 'F', 'AUTRE']).optional(),
  phone: z.string().optional(),
  guardian_name: z.string().optional(),
  guardian_phone: z.string().optional(),
  commune: z.string().min(1),
  chefferie_sector: z.string().optional(),
  neighborhood_group: z.string().optional(),
  avenue_village: z.string().optional(),
  photo: z.string().optional(),
})
const vehicleSchema = z.object({
  registration_number: z.string().min(1),
  vehicle_type: z.enum(['MOTO', 'TRICYCLE']),
  brand: z.string().optional(),
  chassis_number: z.string().optional(),
  engine_number: z.string().optional(),
  color: z.string().optional(),
  usage: z.enum(['TAXI_TRANSPORT_PUBLIC', 'PERSONNEL', 'AUTRE']),
})
const driverSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  middle_name: z.string().optional(),
  date_of_birth: z.string().optional(),
  place_of_birth: z.string().optional(),
  gender: z.enum(['M', 'F', 'AUTRE']).optional(),
  phone: z.string().optional(),
  father_name: z.string().optional(),
  mother_name: z.string().optional(),
  marital_status: z.enum(['CELIBATAIRE', 'MARIE', 'DIVORCE', 'VEUF']).optional(),
  commune: z.string().min(1),
  chefferie_sector: z.string().optional(),
  neighborhood_group: z.string().optional(),
  avenue_village: z.string().optional(),
  origin: z.string().optional(),
  photo: z.string().optional(),
})
const identificationSchema = z.object({
  owner: ownerSchema,
  vehicle: vehicleSchema,
  driver: driverSchema,
  issue_location: z.string().min(1),
  status: z.enum(['ACTIF', 'SUSPENDU', 'EXPIRE', 'ARCHIVE']).default('ACTIF'),
})

app.get('/api/identifications', requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query(`select ir.id, ir.public_id, ir.identification_number, ir.qr_token, ir.status, ir.issue_date, ir.issue_location, d.first_name as driver_first_name, d.last_name as driver_last_name, v.registration_number, o.first_name as owner_first_name, o.last_name as owner_last_name from public.identification_records ir join public.drivers d on d.id = ir.driver_id join public.vehicles v on v.id = ir.vehicle_id join public.owners o on o.id = ir.owner_id order by ir.created_at desc limit 200`)
    res.json(result.rows)
  } catch (error) { next(error) }
})

app.get('/api/identifications/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(`select ir.*, d.first_name as driver_first_name, d.last_name as driver_last_name, d.photo as driver_photo, d.phone as driver_phone, v.registration_number, v.brand, v.vehicle_type, o.first_name as owner_first_name, o.last_name as owner_last_name from public.identification_records ir join public.drivers d on d.id = ir.driver_id join public.vehicles v on v.id = ir.vehicle_id join public.owners o on o.id = ir.owner_id where ir.id = $1 limit 1`, [req.params.id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Fiche introuvable' })
    res.json(result.rows[0])
  } catch (error) { next(error) }
})

app.post('/api/identifications', requireAuth, async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const input = identificationSchema.parse(req.body)
    await client.query('begin')
    const owner = await client.query(`insert into public.owners (first_name, last_name, middle_name, date_of_birth, place_of_birth, gender, phone, guardian_name, guardian_phone, commune, chefferie_sector, neighborhood_group, avenue_village, photo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`, [input.owner.first_name, input.owner.last_name, input.owner.middle_name ?? null, input.owner.date_of_birth ?? null, input.owner.place_of_birth ?? null, input.owner.gender ?? null, input.owner.phone ?? null, input.owner.guardian_name ?? null, input.owner.guardian_phone ?? null, input.owner.commune, input.owner.chefferie_sector ?? null, input.owner.neighborhood_group ?? null, input.owner.avenue_village ?? null, input.owner.photo ?? null])
    const vehicle = await client.query(`insert into public.vehicles (owner_id, registration_number, vehicle_type, brand, chassis_number, engine_number, color, usage) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [owner.rows[0].id, input.vehicle.registration_number, input.vehicle.vehicle_type, input.vehicle.brand ?? null, input.vehicle.chassis_number ?? null, input.vehicle.engine_number ?? null, input.vehicle.color ?? null, input.vehicle.usage])
    const driver = await client.query(`insert into public.drivers (owner_id, first_name, last_name, middle_name, date_of_birth, place_of_birth, gender, phone, father_name, mother_name, marital_status, commune, chefferie_sector, neighborhood_group, avenue_village, origin, photo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`, [owner.rows[0].id, input.driver.first_name, input.driver.last_name, input.driver.middle_name ?? null, input.driver.date_of_birth ?? null, input.driver.place_of_birth ?? null, input.driver.gender ?? null, input.driver.phone ?? null, input.driver.father_name ?? null, input.driver.mother_name ?? null, input.driver.marital_status ?? null, input.driver.commune, input.driver.chefferie_sector ?? null, input.driver.neighborhood_group ?? null, input.driver.avenue_village ?? null, input.driver.origin ?? null, input.driver.photo ?? null])
    const ident = await client.query(`select public.generate_identification_number() as identification_number`)
    const identificationNumber = ident.rows[0].identification_number
    const record = await client.query(`insert into public.identification_records (identification_number, owner_id, vehicle_id, driver_id, issued_by, issue_location, status) values ($1,$2,$3,$4,$5,$6,$7) returning *`, [identificationNumber, owner.rows[0].id, vehicle.rows[0].id, driver.rows[0].id, req.user?.id ?? null, input.issue_location, input.status])
    const publicQrUrl = `${process.env.FRONTEND_URL ?? 'https://fontmotaed.vercel.app'}/verify/${record.rows[0].qr_token}`
    await client.query('update public.identification_records set qr_code_url = $1 where id = $2', [publicQrUrl, record.rows[0].id])
    await client.query('commit')
    res.status(201).json({
      ...record.rows[0],
      qr_code_url: publicQrUrl,
      owner: owner.rows[0],
      vehicle: vehicle.rows[0],
      driver: driver.rows[0],
    })
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    next(error)
  } finally {
    client.release()
  }
})

app.patch('/api/identifications/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body as { status: string }
    if (!['ACTIF', 'SUSPENDU', 'EXPIRE', 'ARCHIVE'].includes(status)) return res.status(400).json({ error: 'Statut invalide' })
    const result = await pool.query('update public.identification_records set status = $1 where id = $2 returning id, status', [status, req.params.id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Fiche introuvable' })
    res.json(result.rows[0])
  } catch (error) { next(error) }
})

app.delete('/api/identifications/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('delete from public.identification_records where id = $1 returning id', [req.params.id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Fiche introuvable' })
    res.status(204).send()
  } catch (error) { next(error) }
})

app.get('/api/identifications/verify/:token', async (req, res, next) => {
  try {
    const result = await pool.query('select public.verify_identification($1) as payload', [req.params.token])
    const payload = result.rows[0]?.payload
    if (!payload || payload.success === false) return res.status(404).json({ success: false, error: payload?.error ?? 'QR Code non reconnu' })
    res.json(payload)
  } catch (error) { next(error) }
})

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.resolve(process.env.FRONTEND_DIST ?? path.join(__dirname, '..', 'dist'))

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { if (error instanceof z.ZodError) return res.status(400).json({ error: 'Données invalides', details: error.flatten() }); console.error(error); res.status(500).json({ error: 'Erreur serveur' }) })
app.listen(port, '0.0.0.0', () => console.log(`MOTAED API listening on http://localhost:${port}`))


