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
app.post('/api/auth/login', async (req, res, next) => { try { const input = loginSchema.parse(req.body); const result = await pool.query('select p.id, p.role, p.status, a.encrypted_password as password_hash from public.users p join auth.users a on a.id = p.id where lower(p.email) = lower($1) limit 1', [input.email]); const user = result.rows[0]; if (!user || user.status !== 'actif' || !user.password_hash || !(await bcrypt.compare(input.password, user.password_hash))) return res.status(401).json({ error: 'Identifiants incorrects' }); res.cookie('motaed_session', tokenFor({ id: user.id, role: user.role }), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }); res.json({ user: { id: user.id, role: user.role } }) } catch (error) { next(error) } })
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('motaed_session'); res.status(204).send() })
app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => res.json({ user: req.user }))

app.get('/api/riders', requireAuth, async (req, res, next) => { try { const search = String(req.query.search ?? ''); const status = String(req.query.status ?? ''); const result = await pool.query(`select id, first_name, last_name, driver_type, identification_number, plate_number, activity_zone, status, created_at from public.riders where ($1 = '' or concat_ws(' ', first_name, last_name, identification_number, plate_number) ilike '%' || $1 || '%') and ($2 = '' or status::text = $2) order by created_at desc limit 100`, [search, status]); res.json(result.rows) } catch (error) { next(error) } })
app.post('/api/riders', requireAuth, async (req: AuthRequest, res, next) => { try { const input = riderSchema.parse(req.body); const driverType = { Motard: 'motard', Taxi: 'chauffeur_taxi', 'Taxi-bus': 'chauffeur_taxi_bus', Autre: 'autre' }[input.type]; const result = await pool.query(`insert into public.riders (first_name, last_name, phone, driver_type, identification_number, plate_number, activity_zone, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, unique_code, first_name, last_name, driver_type, identification_number, plate_number, activity_zone, status, created_at`, [input.firstName, input.lastName, input.phone || null, driverType, `${driverType === 'motard' ? 'MOT' : 'PRO'}-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`, input.plate || null, input.zone || null, req.user?.id]); res.status(201).json({ ...result.rows[0], qr_url: `${process.env.PUBLIC_APP_URL ?? 'http://localhost:5174'}/verify/${result.rows[0].unique_code}` }) } catch (error) { next(error) } })
app.get('/api/verify/:uniqueCode', async (req, res, next) => { try { const result = await pool.query('select * from public.verify_rider($1)', [req.params.uniqueCode]); if (!result.rows[0]) return res.status(404).json({ error: 'QR Code non reconnu' }); res.json(result.rows[0]) } catch (error) { next(error) } })
app.get('/api/stats', requireAuth, async (_req, res, next) => { try { const riders = await pool.query("select count(*) as total, count(*) filter (where status = 'actif') as active from public.riders"); const qr = await pool.query('select count(*) as total from public.qr_codes'); const verifications = await pool.query('select count(*) as total from public.verification_logs'); res.json({ riders: Number(riders.rows[0].total), activeRiders: Number(riders.rows[0].active), qrCodes: Number(qr.rows[0].total), verifications: Number(verifications.rows[0].total) }) } catch (error) { next(error) } })
app.get('/api/stats/chart', requireAuth, async (_req, res, next) => { try { const result = await pool.query(`select to_char(verified_at, 'Dy') as day, count(*) as count from public.verification_logs where verified_at >= now() - interval '7 days' group by 1 order by min(verified_at)`); const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']; const map = Object.fromEntries(result.rows.map((r) => [r.day, Number(r.count)])); res.json(days.map((day) => ({ day, count: map[day] ?? 0 }))) } catch (error) { next(error) } })
app.patch('/api/riders/:id/status', requireAuth, async (req: AuthRequest, res, next) => { try { const { status } = req.body as { status: string }; if (!['actif', 'suspendu', 'expire', 'desactive'].includes(status)) return res.status(400).json({ error: 'Statut invalide' }); const result = await pool.query('update public.riders set status = $1, updated_at = now() where id = $2 returning id, status', [status, req.params.id]); if (!result.rows[0]) return res.status(404).json({ error: 'Profil introuvable' }); res.json(result.rows[0]) } catch (error) { next(error) } })
app.delete('/api/riders/:id', requireAuth, async (req: AuthRequest, res, next) => { try { const result = await pool.query('delete from public.riders where id = $1 returning id', [req.params.id]); if (!result.rows[0]) return res.status(404).json({ error: 'Profil introuvable' }); res.status(204).send() } catch (error) { next(error) } })
app.post('/api/riders/:id/photo', requireAuth, async (req: AuthRequest, res, next) => { try { const { photo_url } = req.body as { photo_url?: string }; const result = await pool.query('update public.riders set photo_url = $1, updated_at = now() where id = $2 returning id, photo_url', [photo_url ?? null, req.params.id]); if (!result.rows[0]) return res.status(404).json({ error: 'Profil introuvable' }); res.json(result.rows[0]) } catch (error) { next(error) } })
app.get('/api/users', requireAuth, async (_req, res, next) => { try { const result = await pool.query('select id, full_name, email, role, status, created_at from public.users order by created_at desc'); res.json(result.rows) } catch (error) { next(error) } })
app.post('/api/users', requireAuth, async (req: AuthRequest, res, next) => { try { const input = z.object({ email: z.string().email(), password: z.string().min(8), fullName: z.string().min(1), role: z.enum(['super_admin', 'admin']) }).parse(req.body); const id = crypto.randomUUID(); const hash = await bcrypt.hash(input.password, 10); await pool.query('insert into auth.users (id, email, encrypted_password, aud, role) values ($1, $2, $3, $4, $5)', [id, input.email, hash, 'authenticated', 'authenticated']); await pool.query('insert into public.users (id, full_name, email, role) values ($1, $2, $3, $4)', [id, input.fullName, input.email, input.role]); res.status(201).json({ id, full_name: input.fullName, email: input.email, role: input.role }) } catch (error) { next(error) } })

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
