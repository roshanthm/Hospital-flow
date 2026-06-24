import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma, withDbRetry } from './src/lib/prisma.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  // Safe progressive transition: if the stored key does not look like a bcrypt hash,
  // do a direct string comparison to avoid locking existing legacy/test records out of the system.
  if (!hash.startsWith('$2a$') && !hash.startsWith('$2b$') && !hash.startsWith('$2y$')) {
    return password === hash;
  }
  return bcrypt.compare(password, hash);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- LIGHTWEIGHT IN-MEMORY CACHING SYSTEM (PHASE 8) ---
interface CacheEntry {
  data: any;
  expiresAt: number;
}
const serverCacheMap = new Map<string, CacheEntry>();

function getCachedData(key: string): any {
  const entry = serverCacheMap.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data;
  }
  return null;
}

function setCachedData(key: string, data: any, ttlMs: number = 10 * 60 * 1000): void {
  serverCacheMap.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function invalidateCachedData(key: string): void {
  serverCacheMap.delete(key);
}

// --- DOCTOR DUTY SHIFT CONFIGS & MANAGEMENT HELPERS ---
async function getShiftSettings() {
  try {
    let settings = await prisma.dutySetting.findUnique({
      where: { id: 'singleton' }
    });
    if (!settings) {
      settings = await prisma.dutySetting.create({
        data: {
          id: 'singleton',
          morningShiftEnd: "01:00 PM",
          eveningShiftEnd: "08:00 PM",
          timezone: "Asia/Kolkata"
        }
      });
    }
    return {
      morningShiftEnd: settings.morningShiftEnd,
      eveningShiftEnd: settings.eveningShiftEnd,
      timezone: settings.timezone
    };
  } catch (e) {
    console.error("Failed to query duty settings from Postgres:", e);
    try {
      const data = fs.readFileSync(path.join(process.cwd(), 'src/lib/dutySettings.json'), 'utf8');
      const parsed = JSON.parse(data);
      return {
        morningShiftEnd: parsed.morningShiftEnd || "01:00 PM",
        eveningShiftEnd: parsed.eveningShiftEnd || "08:00 PM",
        timezone: parsed.timezone || "Asia/Kolkata"
      };
    } catch (err) {
      return {
        morningShiftEnd: "01:00 PM",
        eveningShiftEnd: "08:00 PM",
        timezone: "Asia/Kolkata"
      };
    }
  }
}

function parseTimeString(timeStr: string) {
  const match = timeStr.trim().match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return { hour: 13, minute: 0 };
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hour < 12) {
    hour += 12;
  } else if (period === 'AM' && hour === 12) {
    hour = 0;
  }
  return { hour, minute };
}

function getLocalDateStringInTimezone(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
  } catch (e) {
    try {
      return date.toISOString().split('T')[0];
    } catch (err) {
      return new Date().toISOString().split('T')[0];
    }
  }
}

function getLocalTimeInTimezone(timezone: string) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const valOf = (type: string) => {
      const p = parts.find(x => x.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    
    let hour = valOf('hour');
    if (hour === 24) hour = 0;
    
    return {
      year: valOf('year'),
      month: valOf('month') - 1, // 0-based month
      date: valOf('day'),
      hour,
      minute: valOf('minute'),
      second: valOf('second')
    };
  } catch (e) {
    const d = new Date();
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      date: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds()
    };
  }
}

function getLocalDateParts(date: Date, timezone: string) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const valOf = (type: string) => {
      const p = parts.find(x => x.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    let hour = valOf('hour');
    if (hour === 24) hour = 0;
    return {
      year: valOf('year'),
      month: valOf('month') - 1, // 0-based month
      day: valOf('day'),
      hour,
      minute: valOf('minute'),
      second: valOf('second')
    };
  } catch (e) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds()
    };
  }
}

function getCutoffDateForActivation(activatedAt: Date, settings: { morningShiftEnd: string, eveningShiftEnd: string, timezone: string }) {
  const timezone = settings.timezone || "Asia/Kolkata";
  const local = getLocalDateParts(activatedAt, timezone);
  const parsedMorning = parseTimeString(settings.morningShiftEnd);
  const parsedEvening = parseTimeString(settings.eveningShiftEnd);

  const currentMinutes = local.hour * 60 + local.minute;
  const morningEndMin = parsedMorning.hour * 60 + parsedMorning.minute;
  const eveningEndMin = parsedEvening.hour * 60 + parsedEvening.minute;

  let cutYear = local.year;
  let cutMonth = local.month;
  let cutDay = local.day;
  let cutHour = parsedMorning.hour;
  let cutMin = parsedMorning.minute;
  let assignedShift: 'MORNING' | 'EVENING' = 'MORNING';

  if (currentMinutes < morningEndMin) {
    // Cutoff is morning shift end today
    cutHour = parsedMorning.hour;
    cutMin = parsedMorning.minute;
    assignedShift = 'MORNING';
  } else if (currentMinutes < eveningEndMin) {
    // Cutoff is evening shift end today
    cutHour = parsedEvening.hour;
    cutMin = parsedEvening.minute;
    assignedShift = 'EVENING';
  } else {
    // Cutoff is morning shift end on the next day
    const nextDayDate = new Date(activatedAt.getTime() + 24 * 60 * 60 * 1000);
    const nextLocal = getLocalDateParts(nextDayDate, timezone);
    cutYear = nextLocal.year;
    cutMonth = nextLocal.month;
    cutDay = nextLocal.day;
    cutHour = parsedMorning.hour;
    cutMin = parsedMorning.minute;
    assignedShift = 'MORNING';
  }

  const cutoffDate = getLocalDateInTimezone(cutYear, cutMonth, cutDay, cutHour, cutMin, timezone);
  return { cutoffDate, assignedShift };
}

function getCalendarDateDifference(date1: Date, date2: Date, timezone: string): number {
  const d1Str = getLocalDateStringInTimezone(date1, timezone);
  const d2Str = getLocalDateStringInTimezone(date2, timezone);
  const d1 = new Date(`${d1Str}T00:00:00.000Z`);
  const d2 = new Date(`${d2Str}T00:00:00.000Z`);
  return Math.round((d1.getTime() - d2.getTime()) / (24 * 60 * 60 * 1000));
}

function getLocalDateInTimezone(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const guess = new Date(Date.UTC(year, month, day, hour, minute));
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    
    const parts = formatter.formatToParts(guess);
    const valOf = (type: string) => {
      const p = parts.find(x => x.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    
    const gHour = valOf('hour') === 24 ? 0 : valOf('hour');
    const gMin = valOf('minute');
    const gDay = valOf('day');
    
    const guessLocalMin = gDay * 24 * 60 + gHour * 60 + gMin;
    const desiredLocalMin = day * 24 * 60 + hour * 60 + minute;
    const diffMin = desiredLocalMin - guessLocalMin;
    
    return new Date(guess.getTime() + diffMin * 60 * 1000);
  } catch (e) {
    return guess;
  }
}

let lastShiftCheckTime = 0;

async function checkAndResetDoctorShifts(timezoneOffsetMin?: number | null) {
  const nowMs = Date.now();
  // Throttle to run at most once every 10 seconds to make UI highly responsive
  if (nowMs - lastShiftCheckTime < 10000) {
    return;
  }
  lastShiftCheckTime = nowMs;

  try {
    const doctors = await prisma.user.findMany({
      where: { role: 'DOCTOR', isActive: true }
    });
    
    const settings = await getShiftSettings();
    const timezone = settings.timezone || "Asia/Kolkata";
    const now = new Date();

    const inactiveUserIds: string[] = [];
    const logsToCreate: any[] = [];

    for (const doc of doctors) {
      const currentStatus = doc.dutyStatus;
      if (currentStatus === 'ON DUTY' || currentStatus === 'ON_DUTY') {
        if (!doc.lastActivatedAt) {
          inactiveUserIds.push(doc.id);
          continue;
        }

        const activatedDate = new Date(doc.lastActivatedAt);
        const { cutoffDate, assignedShift } = getCutoffDateForActivation(activatedDate, settings);

        if (now >= cutoffDate) {
          const cutoffTimeStr = assignedShift === 'MORNING' ? settings.morningShiftEnd : settings.eveningShiftEnd;
          inactiveUserIds.push(doc.id);
          logsToCreate.push({
            userId: doc.id,
            userName: doc.name,
            action: 'DUTY_OFF_CUTOFF',
            details: `AUTO_RESET | Shift ended automatically at cutoff ${cutoffTimeStr}`,
            timestamp: cutoffDate
          });
        }
      } else {
        if (doc.dutyStatus !== 'INACTIVE') {
          inactiveUserIds.push(doc.id);
        }
      }
    }

    if (inactiveUserIds.length > 0) {
      await prisma.$transaction([
        prisma.user.updateMany({
          where: { id: { in: inactiveUserIds } },
          data: { dutyStatus: 'INACTIVE' }
        }),
        ...(logsToCreate.length > 0 ? [
          prisma.activityLog.createMany({
            data: logsToCreate
          })
        ] : [])
      ]);
    }
  } catch (error) {
    console.error("Error running checkAndResetDoctorShifts:", error);
  }
}
// -----------------------------------------------------

import crypto from 'crypto';

let JWT_SECRET: string = process.env.JWT_SECRET || '';
if (!JWT_SECRET || JWT_SECRET === 'HospitalSecureJWT_Main_2026_X9#Auth') {
  if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
    console.warn('[SECURITY WARNING] No secure JWT_SECRET environment variable provided for production deployment! Dynamically generating a cryptographically secure key to prevent token compromise.');
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
  } else {
    JWT_SECRET = 'HospitalSecureJWT_Main_2026_X9#Auth';
  }
}

let JWT_REFRESH_SECRET: string = process.env.JWT_REFRESH_SECRET || '';
if (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET === 'HospitalSecureJWT_Refresh_2026_R7#Auth') {
  if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
    console.warn('[SECURITY WARNING] No secure JWT_REFRESH_SECRET environment variable provided for production deployment! Dynamically generating a cryptographically secure key to prevent token compromise.');
    JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
  } else {
    JWT_REFRESH_SECRET = 'HospitalSecureJWT_Refresh_2026_R7#Auth';
  }
}

const parseCookies = (cookieHeader?: string) => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const parts = c.split('=');
    if (parts.length === 2) {
      cookies[parts[0].trim()] = decodeURIComponent(parts[1].trim());
    }
  });
  return cookies;
};

const authenticateJWT = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; role: string };
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid access token' });
  }
};

const requireRole = (roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: You do not have the required role to access this resource.' });
    }
    next();
  };
};

// --- RATE LIMITING ARCHITECTURE ---
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

function rateLimiter(options: { windowMs: number; max: number; message: string }) {
  return (req: any, res: any, next: any) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${req.path}:${ip}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record) {
      record = { count: 1, resetTime: now + options.windowMs };
      rateLimitStore.set(key, record);
    } else if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + options.windowMs;
    } else {
      record.count++;
    }

    const remaining = Math.max(0, options.max - record.count);
    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > options.max) {
      return res.status(429).json({ error: options.message });
    }

    next();
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Security Headers Middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Temporary Telemetry Middleware for Phase D Target Audits
  app.use((req, res, next) => {
    const targets = [
      '/api/tokens',
      '/api/users',
      '/api/pharmacy/queue',
      '/api/admin/operational-summary'
    ];
    const isTarget = targets.includes(req.path) || (req.path.startsWith('/api/patients/') && req.path.endsWith('/history'));

    if (isTarget) {
      const start = performance.now();
      const originalSend = res.send;
      res.send = function (body) {
        const duration = (performance.now() - start).toFixed(2);
        const sizeBytes = body ? (typeof body === 'string' ? Buffer.byteLength(body) : Buffer.byteLength(JSON.stringify(body))) : 0;
        console.log(`[TELEMETRY] ${req.method} ${req.path} | DURATION: ${duration}ms | PAYLOAD: ${sizeBytes} bytes`);
        return originalSend.apply(this, arguments as any);
      };
    }
    next();
  });

  // General API Throttling & Protection against brute-force and overhead
  app.use('/api', rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 200, // Max 200 requests per minute
    message: 'Too many requests to the Clinical API. Request throttling is active to protect database status.'
  }));

  const loginLimiter = rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Max 10 attempts
    message: 'Too many login attempts. Brute-force protection activated. Please wait 60 seconds before trying again.'
  });

  const refreshLimiter = rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // Max 30 attempts
    message: 'Too many refresh token cycles. Infinite loop mitigation activated. Please log in again.'
  });

  const PORT = process.env.PORT || 3000;

  // --- API ROUTES ---

  // Auth
  app.post('/api/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    try {
      if (!email || !password) {
        return res.status(400).json({ error: 'Please enter both email address and password.' });
      }

      const timezoneOffsetHeader = req.headers['x-timezone-offset'];
      const timezoneOffsetMin = timezoneOffsetHeader ? parseInt(timezoneOffsetHeader as string, 10) : null;
      // Offload to background process to ensure rapid login response times
      checkAndResetDoctorShifts(timezoneOffsetMin).catch(err => {
        console.error('Error checking shifts on login:', err);
      });

      let user;
      try {
        // Query user first including inactive state so we can distinguish deactivated accounts
        user = await withDbRetry(() => prisma.user.findUnique({
          where: { email }
        }));
      } catch (dbError: any) {
        console.error('Database connection / cold-start error during login:', dbError);
        const errMsg = String(dbError.message || dbError).toLowerCase();
        const errCode = String(dbError.code || '');
        if (
          errMsg.includes('connection') ||
          errMsg.includes('timeout') ||
          errMsg.includes('etimedout') ||
          errMsg.includes('reach database') ||
          errMsg.includes('pool') ||
          errMsg.includes('socket') ||
          errMsg.includes('hang up') ||
          errCode === 'P1001' ||
          errCode === 'P1002' ||
          errCode === 'P1017'
        ) {
          return res.status(503).json({ 
            error: 'Database connection issue. The clinical registry server is currently warming up (Neon cold-start). Please wait a few seconds and try again.' 
          });
        }
        return res.status(500).json({ error: 'Clinical registry database query failed. Please retry.' });
      }

      if (!user) {
        return res.status(401).json({ error: 'No active hospital staff account found with this email.' });
      }

      if (!user.isActive) {
        return res.status(403).json({ error: 'This clinical account has been suspended or deactivated. Contact administrative services.' });
      }

      if (!user.password) {
        return res.status(401).json({ error: 'No login credentials configured for this account.' });
      }

      const isPlaintext = !user.password.startsWith('$2a$') && !user.password.startsWith('$2b$') && !user.password.startsWith('$2y$');
      const isPasswordCorrect = await comparePassword(password, user.password);

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Incorrect workspace password. Please try again.' });
      }

      // Proactive Upgrade Logic: If the user successfully logged in with a legacy plain-text password,
      // seamlessly upgrade it to a secure bcrypt hash in the database.
      if (isPlaintext) {
        try {
          const newAndSecuredHash = await hashPassword(password);
          await prisma.user.update({
            where: { id: user.id },
            data: { password: newAndSecuredHash }
          });
          console.log(`[SECURITY] Seamlessly migrated password for ${user.email} to secure bcrypt hash format.`);
        } catch (upgradeErr) {
          console.error(`Failed to migrate plain-text password for ${user.email}:`, upgradeErr);
        }
      }

      let accessToken;
      let refreshToken;
      try {
        accessToken = jwt.sign(
          { userId: user.id, email: user.email, role: user.role },
          JWT_SECRET,
          { expiresIn: '15m' }
        );

        refreshToken = jwt.sign(
          { userId: user.id },
          JWT_REFRESH_SECRET,
          { expiresIn: '7d' }
        );
      } catch (jwtErr) {
        console.error('JWT generation failure:', jwtErr);
        return res.status(500).json({ error: 'Secure Token Authority failed to generate session keys. Please retry.' });
      }

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 15 * 60 * 1000
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      // Audit Log for Session Authentication
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          userName: user.name,
          action: 'LOGIN',
          details: `User logged in: ${user.name} (${user.role})`,
          timestamp: new Date()
        }
      });

      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        isActive: user.isActive,
        dutyStatus: user.dutyStatus,
        shiftType: user.shiftType,
        lastActivatedAt: user.lastActivatedAt,
        requiresPasswordChange: user.requiresPasswordChange,
        pin: user.pin,
        accessToken,
        refreshToken
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal system workspace error. Contact administrator.' });
    }
  });

  app.post('/api/refresh', refreshLimiter, async (req, res) => {
    const { refreshToken: bodyToken } = req.body;
    const cookies = parseCookies(req.headers.cookie);
    const token = bodyToken || cookies.refreshToken;

    if (!token) {
      return res.status(401).json({ error: 'Refresh token missing. Please sign in.' });
    }

    try {
      const timezoneOffsetHeader = req.headers['x-timezone-offset'];
      const timezoneOffsetMin = timezoneOffsetHeader ? parseInt(timezoneOffsetHeader as string, 10) : null;
      await checkAndResetDoctorShifts(timezoneOffsetMin);

      let decoded;
      try {
        decoded = jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string };
      } catch (jwtErr) {
        return res.status(401).json({ error: 'Invalid or expired clinical session refresh token. Please login again.' });
      }

      let user;
      try {
        user = await withDbRetry(() => prisma.user.findUnique({
          where: { id: decoded.userId }
        }));
      } catch (dbError: any) {
        console.error('Database connection error during token refresh:', dbError);
        return res.status(503).json({ error: 'Database connection issue while validating active session database states.' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Active clinical staff member record not found.' });
      }

      if (!user.isActive) {
        return res.status(403).json({ error: 'Your staff account has been deactivated.' });
      }

      const accessToken = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 15 * 60 * 1000
      });

      res.json({
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          isActive: user.isActive,
          dutyStatus: user.dutyStatus,
          shiftType: user.shiftType,
          lastActivatedAt: user.lastActivatedAt,
          requiresPasswordChange: user.requiresPasswordChange,
          pin: user.pin
        }
      });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid refresh token key pair.' });
    }
  });

  app.post('/api/logout', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      let token = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      } else {
        const cookies = parseCookies(req.headers.cookie);
        token = cookies.accessToken;
      }

      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; role: string };
          if (decoded) {
            const usr = await prisma.user.findUnique({ where: { id: decoded.userId } });
            if (usr) {
              await prisma.activityLog.create({
                data: {
                  userId: usr.id,
                  userName: usr.name,
                  action: 'LOGOUT',
                  details: `User logged out: ${usr.name}`
                }
              });
            }
          }
        } catch (jwtErr) {
          // Ignore verification failures on logout so users are still logged out safely
        }
      }
    } catch (err) {
      console.error('Error on logout:', err);
    }

    res.clearCookie('accessToken', { path: '/', httpOnly: true, secure: true, sameSite: 'none' });
    res.clearCookie('refreshToken', { path: '/', httpOnly: true, secure: true, sameSite: 'none' });
    res.json({ success: true, message: 'Logged out successfully' });
  });

  // --- Password Recovery & Changes ---
  app.post('/api/auth/forgot-password', async (req, res) => {
    const { employeeIdOrPin } = req.body;
    try {
      if (!employeeIdOrPin || !employeeIdOrPin.trim()) {
        return res.status(400).json({ error: 'Please enter your Employee ID or PIN.' });
      }

      const searchKey = employeeIdOrPin.trim();
      
      // Let's search by employeeId or pin in a case-insensitive context
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { employeeId: { equals: searchKey, mode: 'insensitive' } },
            { pin: { equals: searchKey } }
          ]
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'No active clinical account found with this Employee ID or PIN.' });
      }

      // Check if there is already a PENDING request for this user to avoid duplication
      const existingRequest = await prisma.passwordResetRequest.findFirst({
        where: {
          userId: user.id,
          status: 'PENDING'
        }
      });

      if (existingRequest) {
        return res.json({ 
          success: true, 
          message: 'An active password recovery request is already pending review. Please ask your administrator to authorize it.' 
        });
      }

      // Create a password reset request
      await prisma.passwordResetRequest.create({
        data: {
          userId: user.id,
          employeeId: user.employeeId || 'UNKNOWN',
          status: 'PENDING',
          requestTime: new Date()
        }
      });

      res.json({
        success: true,
        message: 'Password recovery request submitted successfully. Please ask your administrator to authorize it and generate your temporary password.'
      });
    } catch (error: any) {
      console.error('Password reset request error:', error);
      res.status(500).json({ error: error.message || 'Internal server error processing recovery request.' });
    }
  });

  app.get('/api/admin/password-reset-requests', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    try {
      const requests = await prisma.passwordResetRequest.findMany({
        where: { status: 'PENDING' },
        orderBy: { requestTime: 'desc' }
      });

      const userIds = Array.from(new Set(requests.map(r => r.userId).filter(Boolean)));
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } }
      });
      const userMap = new Map(users.map(u => [u.id, u]));

      const requestsWithUser = requests.map((r) => {
        const user = userMap.get(r.userId);
        return {
          id: r.id,
          userId: r.userId,
          employeeId: r.employeeId,
          requestTime: r.requestTime,
          status: r.status,
          userName: user ? user.name : 'Unknown Employee',
          userRole: user ? user.role : 'UNKNOWN',
          userDepartment: user ? user.department : 'General'
        };
      });

      res.json(requestsWithUser);
    } catch (error: any) {
      console.error('Fetch reset requests error:', error);
      res.status(500).json({ error: 'Failed to retrieve password reset requests.' });
    }
  });

  app.post('/api/admin/password-reset-requests/:id/resolve', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    const requestId = req.params.id;
    try {
      const request = await prisma.passwordResetRequest.findUnique({
        where: { id: requestId }
      });

      if (!request || request.status !== 'PENDING') {
        return res.status(400).json({ error: 'Request not found or has already been resolved.' });
      }

      // Generate secure temporary password: DOC followed by 6 random digits
      const tempPass = `DOC${Math.floor(100000 + Math.random() * 900000)}`;
      const hashedTempPass = await hashPassword(tempPass);

      await prisma.$transaction([
        prisma.user.update({
          where: { id: request.userId },
          data: {
            password: hashedTempPass,
            requiresPasswordChange: true
          }
        }),
        prisma.passwordResetRequest.update({
          where: { id: requestId },
          data: {
            status: 'RESOLVED'
          }
        })
      ]);

      res.json({
        success: true,
        message: 'Temporary password generated successfully.',
        tempPassword: tempPass
      });
    } catch (error: any) {
      console.error('Resolve reset request error:', error);
      res.status(500).json({ error: 'Failed to generate temporary credentials.' });
    }
  });

  app.post('/api/admin/password-reset-requests/:id/reject', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    const requestId = req.params.id;
    try {
      const request = await prisma.passwordResetRequest.findUnique({
        where: { id: requestId }
      });

      if (!request || request.status !== 'PENDING') {
        return res.status(400).json({ error: 'Request not found or has already been resolved.' });
      }

      await prisma.passwordResetRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED'
        }
      });

      res.json({
        success: true,
        message: 'Password recovery request rejected and removed from pending queue.'
      });
    } catch (error: any) {
      console.error('Reject reset request error:', error);
      res.status(500).json({ error: 'Failed to reject recovery request.' });
    }
  });

  app.get('/api/admin/doctors-workload', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const aggregations = await prisma.token.groupBy({
        by: ['doctorId', 'status'],
        where: {
          createdAt: {
            gte: startOfToday
          }
        },
        _count: {
          id: true
        }
      });

      const workload: Record<string, { activePatients: number; todayConsultations: number }> = {};
      aggregations.forEach(agg => {
        const docId = agg.doctorId;
        if (!workload[docId]) {
          workload[docId] = { activePatients: 0, todayConsultations: 0 };
        }
        if (agg.status === 'WAITING' || agg.status === 'IN_CONSULTATION') {
          workload[docId].activePatients += agg._count.id;
        } else if (agg.status === 'COMPLETED') {
          workload[docId].todayConsultations += agg._count.id;
        }
      });

      res.json(workload);
    } catch (error) {
      console.error('Failed to calculate doctors workload:', error);
      res.status(500).json({ error: 'Failed to calculate doctors workload' });
    }
  });

  app.get('/api/admin/doctor-attendance', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      // Parse start and end dates strictly via UTC boundaries to avoid container local timezone offsets
      let start: Date;
      let end: Date;

      if (startDate) {
        const sDateStr = (startDate as string).split('T')[0];
        start = new Date(`${sDateStr}T00:00:00.000Z`);
      } else {
        const todayStr = new Date().toISOString().split('T')[0];
        start = new Date(`${todayStr}T00:00:00.000Z`);
      }

      if (endDate) {
        const eDateStr = (endDate as string).split('T')[0];
        end = new Date(`${eDateStr}T23:59:59.999Z`);
      } else {
        const todayStr = new Date().toISOString().split('T')[0];
        end = new Date(`${todayStr}T23:59:59.999Z`);
      }

      // Limit range to 31 days maximum to prevent unbounded date-range system scans
      const diffTime = end.getTime() - start.getTime();
      const diffDaysLimit = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDaysLimit > 31) {
        // Adjust start date to be exactly 31 days prior to end date
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sDateStr = start.toISOString().split('T')[0];
        start = new Date(`${sDateStr}T00:00:00.000Z`);
      }

      const settings = await getShiftSettings();
      const timezone = settings.timezone || "Asia/Kolkata";
      const todayStr = getLocalDateStringInTimezone(new Date(), timezone);

      // Pad query range by 24 hours to safely capture all boundary logs for the target timezone
      const dbStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
      const dbEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000);

      // Fetch all active doctors
      const doctors = await prisma.user.findMany({
        where: {
          role: 'DOCTOR',
          isActive: true
        },
        orderBy: { name: 'asc' }
      });

      // Fetch all activity logs in the padded range of interest to attendance
      const logs = await prisma.activityLog.findMany({
        where: {
          timestamp: {
            gte: dbStart,
            lte: dbEnd
          },
          action: {
            in: ['DUTY_ON', 'DUTY_OFF_MANUAL', 'DUTY_OFF_CUTOFF']
          }
        },
        select: {
          userId: true,
          action: true,
          timestamp: true
        },
        orderBy: { timestamp: 'asc' }
      });

      // Fetch all consultations completed in the padded range with required projection
      const consultations = await prisma.consultation.findMany({
        where: {
          createdAt: {
            gte: dbStart,
            lte: dbEnd
          }
        },
        select: {
          id: true,
          doctorId: true,
          patientId: true,
          createdAt: true
        },
        orderBy: { createdAt: 'asc' }
      });

      // We will generate the daily list of rows
      const rows: any[] = [];
      const dStart = new Date(start.toISOString().split('T')[0] + 'T00:00:00.000Z');
      const dEnd = new Date(end.toISOString().split('T')[0] + 'T00:00:00.000Z');
      const diffDays = Math.round((dEnd.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // Iterate through each date in the range using UTC safely
      for (let i = 0; i < diffDays; i++) {
        const currentDate = new Date(start);
        currentDate.setUTCDate(start.getUTCDate() + i);
        const dateStr = currentDate.toISOString().split('T')[0];

        // Process for each doctor on this day
        for (const doctor of doctors) {
          // Filter logs that fall on dateStr in target timezone
          const doctorLogs = logs.filter(
            (l) => l.userId === doctor.id && getLocalDateStringInTimezone(l.timestamp, timezone) === dateStr
          );

          // Filter consultations that fall on dateStr in target timezone
          const doctorConsultations = consultations.filter(
            (c) => c.doctorId === doctor.id && getLocalDateStringInTimezone(c.createdAt, timezone) === dateStr
          );

          // 1. Duty Activated (must be earliest 'DUTY_ON' action today or current active lastActivatedAt)
          const dutyOnLogs = doctorLogs.filter(l => l.action === 'DUTY_ON');
          const isTodayRow = (dateStr === todayStr);
          let dutyActivatedTime = dutyOnLogs.length > 0 ? dutyOnLogs[0].timestamp : null;

          if (doctor.lastActivatedAt) {
            const activationLocalDay = getLocalDateStringInTimezone(doctor.lastActivatedAt, timezone);
            if (activationLocalDay === dateStr) {
              if (!dutyActivatedTime || doctor.lastActivatedAt < dutyActivatedTime) {
                dutyActivatedTime = doctor.lastActivatedAt;
              }
            }
          }

          if (isTodayRow && doctor.dutyStatus === 'ON DUTY' && !dutyActivatedTime) {
            dutyActivatedTime = doctor.lastActivatedAt;
          }

          // 2. Duty Deactivated (must be latest deactivation action 'DUTY_OFF_MANUAL' or 'DUTY_OFF_CUTOFF' or computed cutoff if closed)
          let dutyDeactivatedTime = null;
          if (isTodayRow && doctor.dutyStatus === 'ON DUTY') {
            dutyDeactivatedTime = null;
          } else {
            const dutyOffLogs = doctorLogs.filter(l => l.action === 'DUTY_OFF_MANUAL' || l.action === 'DUTY_OFF_CUTOFF');
            if (dutyOffLogs.length > 0) {
              dutyDeactivatedTime = dutyOffLogs[dutyOffLogs.length - 1].timestamp;
            } else if (dutyActivatedTime) {
              const { cutoffDate } = getCutoffDateForActivation(dutyActivatedTime, settings);
              dutyDeactivatedTime = cutoffDate;
            }
          }

          // 3. Consultations Completed
          const consultationsCompleted = doctorConsultations.length;

          // 4. Patients Seen (Unique)
          const patientIds = new Set(doctorConsultations.map((c) => c.patientId));
          const patientsSeen = patientIds.size;

          // 5. Attendance status calculation:
          // PRESENT on physical past attendance is locked forever.
          // ON DUTY / INACTIVE/ ABSENT for today.
          let attendanceStatus = 'ABSENT';
          if (dutyActivatedTime) {
            if (isTodayRow) {
              if (doctor.dutyStatus === 'ON DUTY') {
                attendanceStatus = 'ON DUTY';
              } else {
                attendanceStatus = 'INACTIVE';
              }
            } else {
              attendanceStatus = 'PRESENT';
            }
          } else {
            attendanceStatus = 'ABSENT';
          }

          rows.push({
            doctorId: doctor.id,
            doctorName: doctor.name,
            department: doctor.department || 'General Medicine',
            employeeId: doctor.employeeId || 'N/A',
            date: dateStr,
            dutyActivatedTime,
            dutyDeactivatedTime,
            consultationsCompleted,
            patientsSeen,
            attendanceStatus
          });
        }
      }

      // Today context metrics based on Hospital Timezone date string
      const todayRows = rows.filter((r) => r.date === todayStr);

      const doctorsPresentToday = todayRows.filter((r) => r.dutyActivatedTime !== null).length;
      const doctorsAbsentToday = todayRows.filter((r) => r.dutyActivatedTime === null).length;
      const doctorsOnDutyNow = doctors.filter((d) => d.dutyStatus === 'ON DUTY').length;

      // Overall average completed consultations per doctor in range
      const totalConsultations = consultations.length;
      const avgConsultations = doctors.length > 0 ? +(totalConsultations / doctors.length).toFixed(2) : 0;

      res.json({
        rows: rows.sort((a, b) => b.date.localeCompare(a.date) || a.doctorName.localeCompare(b.doctorName)),
        summary: {
          doctorsPresentToday,
          doctorsAbsentToday,
          doctorsOnDutyNow,
          avgConsultations
        }
      });
    } catch (error: any) {
      console.error('Doctor attendance report query failure:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch doctor attendance reports.' });
    }
  });

  app.post('/api/auth/change-password', authenticateJWT, async (req: any, res) => {
    const { newPassword } = req.body;
    try {
      if (!newPassword || newPassword.trim().length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters in length and secure.' });
      }

      const hashedNewPass = await hashPassword(newPassword.trim());

      await prisma.user.update({
        where: { id: req.user.userId },
        data: {
          password: hashedNewPass,
          requiresPasswordChange: false
        }
      });

      res.json({
        success: true,
        message: 'Password changed successfully. Your medical workstation access has been unlocked.'
      });
    } catch (error: any) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Failed to update password. Please retry.' });
    }
  });

  // Get Current Profile with live check and reset
  app.get('/api/me', authenticateJWT, async (req: any, res) => {
    try {
      const timezoneOffsetHeader = req.headers['x-timezone-offset'];
      const timezoneOffsetMin = timezoneOffsetHeader ? parseInt(timezoneOffsetHeader as string, 10) : null;
      await checkAndResetDoctorShifts(timezoneOffsetMin);
      
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId }
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        isActive: user.isActive,
        dutyStatus: user.dutyStatus,
        shiftType: user.shiftType,
        lastActivatedAt: user.lastActivatedAt,
        requiresPasswordChange: user.requiresPasswordChange,
        pin: user.pin
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve profile status' });
    }
  });

  // --- COMPILER WORKLOAD OPTIMIZED AGGREGATED ADMIN ENDPOINTS (PHASE 5) ---
  app.get('/api/admin/dashboard-kpis', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    try {
      const [
        usersCount,
        patientsCount,
        totalPrescriptionsCount,
        tokensCount,
        doctorsCount,
        doctorsOnDutyCount,
        totalBillsCount
      ] = await Promise.all([
        prisma.user.count({ where: { isActive: true } }),
        prisma.patient.count(),
        prisma.prescription.count(),
        prisma.token.count(),
        prisma.user.count({ where: { role: 'DOCTOR', isActive: true } }),
        prisma.user.count({ where: { role: 'DOCTOR', isActive: true, dutyStatus: 'ON DUTY' } }),
        prisma.bill.count()
      ]);

      res.json({
        usersCount,
        patientsCount,
        totalPrescriptionsCount,
        tokensCount,
        doctorsCount,
        doctorsOnDutyCount,
        totalBillsCount
      });
    } catch (error) {
      console.error('Failed to calculate dashboard KPIs:', error);
      res.status(500).json({ error: 'Failed to calculate KPIs' });
    }
  });

  app.get('/api/admin/revenue-summary', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    const { timeFilter } = req.query;
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startOfCurrentYear = new Date(currentYear, 0, 1);
      const startOfPrevYear = new Date(currentYear - 1, 0, 1);

      const filterRangeStart = timeFilter === '30days' ? thirtyDaysAgo : startOfCurrentYear;

      // 1. Fetch core KPIs from database aggregates
      const [paidAgg, unpaidAgg] = await Promise.all([
        prisma.bill.aggregate({
          where: {
            status: 'PAID',
            createdAt: { gte: filterRangeStart }
          },
          _sum: { total: true },
          _count: { id: true }
        }),
        prisma.bill.aggregate({
          where: {
            status: 'UNPAID',
            createdAt: { gte: filterRangeStart }
          },
          _sum: { total: true },
          _count: { id: true }
        })
      ]);

      const totalRevenueFiltered = paidAgg._sum.total || 0;
      const outstandingInvoicesFiltered = unpaidAgg._sum.total || 0;
      const settledBillsCountFiltered = paidAgg._count.id || 0;
      
      const totalInRange = settledBillsCountFiltered + (unpaidAgg._count.id || 0);
      const settlementRate = totalInRange > 0
        ? `${((settledBillsCountFiltered / totalInRange) * 100).toFixed(1)}%`
        : '0.0%';

      // 2. Fetch specific subsets for dynamic growth rates
      let dynamicGrowth = '0.0%';
      if (timeFilter === '30days') {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const [thisPeriodAgg, lastPeriodAgg] = await Promise.all([
          prisma.bill.aggregate({
            where: { status: 'PAID', createdAt: { gte: thirtyDaysAgo } },
            _sum: { total: true }
          }),
          prisma.bill.aggregate({
            where: { status: 'PAID', createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
            _sum: { total: true }
          })
        ]);

        const thisPeriodPaid = thisPeriodAgg._sum.total || 0;
        const lastPeriodPaid = lastPeriodAgg._sum.total || 0;

        if (lastPeriodPaid === 0) {
          dynamicGrowth = thisPeriodPaid > 0 ? '+100.0%' : '0.0%';
        } else {
          const growth = ((thisPeriodPaid - lastPeriodPaid) / lastPeriodPaid) * 100;
          dynamicGrowth = `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`;
        }
      } else {
        const startOfLastYear = new Date(currentYear - 1, 0, 1);
        const endOfLastYear = new Date(currentYear - 1, 11, 31, 23, 59, 59, 999);

        const [thisYearAgg, lastYearAgg] = await Promise.all([
          prisma.bill.aggregate({
            where: { status: 'PAID', createdAt: { gte: startOfCurrentYear } },
            _sum: { total: true }
          }),
          prisma.bill.aggregate({
            where: { status: 'PAID', createdAt: { gte: startOfLastYear, lte: endOfLastYear } },
            _sum: { total: true }
          })
        ]);

        const thisYearPaid = thisYearAgg._sum.total || 0;
        const lastYearPaid = lastYearAgg._sum.total || 0;

        if (lastYearPaid === 0) {
          dynamicGrowth = thisYearPaid > 0 ? '+100.0%' : '0.0%';
        } else {
          const growth = ((thisYearPaid - lastYearPaid) / lastYearPaid) * 100;
          dynamicGrowth = `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`;
        }
      }

      // 3. Generate trend chart data using highly restricted database aggregations
      let trendChartData: any[] = [];
      const monthsAbbrev = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      if (timeFilter === '30days') {
        const thirtyDaysAgoPrevYear = new Date(thirtyDaysAgo);
        thirtyDaysAgoPrevYear.setFullYear(thirtyDaysAgoPrevYear.getFullYear() - 1);
        const nowPrevYear = new Date(now);
        nowPrevYear.setFullYear(nowPrevYear.getFullYear() - 1);

        const [currentPeriodBills, prevPeriodBills] = await Promise.all([
          prisma.$queryRaw<any[]>`
            SELECT DATE_TRUNC('day', "createdAt")::date as date, SUM(total) as total
            FROM "Bill"
            WHERE status = 'PAID' AND "createdAt" >= ${thirtyDaysAgo}
            GROUP BY DATE_TRUNC('day', "createdAt")
          `,
          prisma.$queryRaw<any[]>`
            SELECT DATE_TRUNC('day', "createdAt")::date as date, SUM(total) as total
            FROM "Bill"
            WHERE status = 'PAID' AND "createdAt" >= ${thirtyDaysAgoPrevYear} AND "createdAt" <= ${nowPrevYear}
            GROUP BY DATE_TRUNC('day', "createdAt")
          `
        ]);

        const last30Days = Array.from({ length: 30 }).map((_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (29 - i));
          return d;
        });

        trendChartData = last30Days.map(date => {
          const dateStr = date.toDateString();
          const currentDayTotal = currentPeriodBills
            .filter(b => new Date(b.date).toDateString() === dateStr)
            .reduce((sum, b) => sum + (Number(b.total) || 0), 0);

          const prevYearDate = new Date(date);
          prevYearDate.setFullYear(prevYearDate.getFullYear() - 1);
          const prevYearDayTotal = prevPeriodBills
            .filter(b => new Date(b.date).toDateString() === prevYearDate.toDateString())
            .reduce((sum, b) => sum + (Number(b.total) || 0), 0);

          return {
            name: `${date.getDate()} ${monthsAbbrev[date.getMonth()]}`,
            current: currentDayTotal,
            previous: prevYearDayTotal
          };
        });
      } else {
        const startOfLastYear = new Date(currentYear - 1, 0, 1);
        const yearlyBills = await prisma.$queryRaw<any[]>`
          SELECT 
            EXTRACT(YEAR FROM "createdAt")::INTEGER as year,
            EXTRACT(MONTH FROM "createdAt")::INTEGER as month,
            SUM(total) as total
          FROM "Bill"
          WHERE status = 'PAID' AND "createdAt" >= ${startOfLastYear}
          GROUP BY EXTRACT(YEAR FROM "createdAt"), EXTRACT(MONTH FROM "createdAt")
        `;

        trendChartData = monthsAbbrev.map((m, index) => {
          const monthNum = index + 1;

          const currentTotal = yearlyBills
            .filter(b => Number(b.year) === currentYear && Number(b.month) === monthNum)
            .reduce((sum, b) => sum + (Number(b.total) || 0), 0);

          const prevTotal = yearlyBills
            .filter(b => Number(b.year) === (currentYear - 1) && Number(b.month) === monthNum)
            .reduce((sum, b) => sum + (Number(b.total) || 0), 0);

          const isFutureMonth = currentYear === now.getFullYear() && index > now.getMonth();

          return {
            name: m,
            current: isFutureMonth && currentTotal === 0 ? null : currentTotal,
            previous: prevTotal
          };
        });
      }

      // 4. Calculate departmental revenue distribution only for active filtered range using database joins & aggregations
      const departmentsList = await prisma.department.findMany({ select: { name: true } });
      const existingDeptNames = departmentsList.map(d => d.name);

      const revenueMap: Record<string, number> = {};
      existingDeptNames.forEach(d => {
        revenueMap[d] = 0;
      });

      const departmentRevenues = await prisma.$queryRaw<any[]>`
        SELECT u.department as department, SUM(b.total) as total
        FROM "Bill" b
        LEFT JOIN "PharmacyDispensingLog" pdl ON b."dispensingLogId" = pdl.id
        LEFT JOIN "PharmacyQueue" pq ON pdl."pharmacyQueueId" = pq.id
        LEFT JOIN "Prescription" p ON pq."prescriptionId" = p.id
        LEFT JOIN "User" u ON p."doctorId" = u.id
        WHERE b."createdAt" >= ${filterRangeStart}
        GROUP BY u.department
      `;

      departmentRevenues.forEach((item) => {
        const doctorDept = item.department;
        const total = Number(item.total) || 0;
        if (doctorDept) {
          const normDeptName = doctorDept.charAt(0).toUpperCase() + doctorDept.slice(1).toLowerCase();
          const matchedDept = existingDeptNames.find(d => d.toLowerCase() === normDeptName.toLowerCase());
          const key = matchedDept || normDeptName;
          revenueMap[key] = (revenueMap[key] || 0) + total;
        } else {
          revenueMap['Pharmacy/Dispensing'] = (revenueMap['Pharmacy/Dispensing'] || 0) + total;
        }
      });

      const activeDepts = Object.entries(revenueMap)
        .filter(([name, value]) => value > 0 || existingDeptNames.includes(name))
        .map(([name, value]) => ({ name, value }));

      const maxVal = Math.max(...activeDepts.map(d => d.value), 0) || 1;
      const calculatedDeptData = activeDepts
        .map(d => ({
          name: d.name,
          value: d.value,
          pct: `${Math.round((d.value / maxVal) * 100)}%`
        }))
        .sort((a, b) => b.value - a.value);

      res.json({
        totalRevenueFiltered,
        outstandingInvoicesFiltered,
        settledBillsCountFiltered,
        settlementRate,
        dynamicGrowth,
        trendChartData,
        calculatedDeptData
      });
    } catch (error) {
      console.error('Failed to calculate revenue summary:', error);
      res.status(500).json({ error: 'Failed to calculate revenue summary' });
    }
  });

  // Operational Summary Cache
  const operationalSummaryCache = new Map<string, { expiry: number; data: any }>();

  app.get('/api/admin/operational-summary', authenticateJWT, requireRole(['ADMIN']), async (req: any, res: any) => {
    const { timeFilter } = req.query;
    const cacheKey = String(timeFilter || '30days');
    const nowMs = Date.now();
    const cached = operationalSummaryCache.get(cacheKey);

    if (cached && nowMs < cached.expiry) {
      return res.json(cached.data);
    }

    try {
      const now = new Date();
      const whereClause: any = {};
      
      let startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days
      if (timeFilter === '24h') {
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (timeFilter === '7days') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }
      
      whereClause.createdAt = { gte: startDate };

      // Query database entities in optimal parallel operations
      const [
        billGroups,
        consultationsCount,
        prescriptionsDispensedCount,
        periodPatientsCount,
        doctorsOnDutyCount,
        totalDoctorsCount,
        activeTokensCount,
        recentCompletedTokens
      ] = await Promise.all([
        prisma.bill.groupBy({
          by: ['status'],
          where: whereClause,
          _count: { id: true },
          _sum: { total: true }
        }),
        prisma.consultation.count({ where: whereClause }),
        prisma.prescription.count({
          where: {
            ...whereClause,
            status: 'DISPENSED'
          }
        }),
        prisma.patient.count({ where: whereClause }),
        prisma.user.count({ where: { role: 'DOCTOR', isActive: true, dutyStatus: { in: ['ON DUTY', 'ON_DUTY'] } } }),
        prisma.user.count({ where: { role: 'DOCTOR', isActive: true } }),
        prisma.token.count({
          where: {
            ...whereClause,
            status: { in: ['WAITING', 'IN_CONSULTATION', 'SENT_TO_PHARMACY'] }
          }
        }),
        prisma.token.findMany({
          where: {
            ...whereClause,
            visitRecord: { consultation: { isNot: null } }
          },
          select: {
            createdAt: true,
            visitRecord: {
              select: {
                consultation: {
                  select: {
                    createdAt: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 100
        })
      ]);

      // Telemetry aggregates
      let totalBillsGenerated = 0;
      let totalPaidBills = 0;
      let totalUnpaidBills = 0;
      let totalCancelledBills = 0;
      let pharmacyRevenueSum = 0;

      billGroups.forEach(group => {
        const count = group._count.id || 0;
        totalBillsGenerated += count;
        if (group.status === 'PAID') {
          totalPaidBills = count;
          pharmacyRevenueSum = group._sum.total || 0;
        } else if (group.status === 'UNPAID') {
          totalUnpaidBills = count;
        } else if (group.status === 'CANCELLED') {
          totalCancelledBills = count;
        }
      });

      // Calculate Average Consultation wait times accurately using the recent 500 completions
      let totalWaitMs = 0;
      let matchedTokensCount = 0;
      recentCompletedTokens.forEach((t: any) => {
        const consTime = t.visitRecord?.consultation?.createdAt;
        if (consTime) {
          totalWaitMs += new Date(consTime).getTime() - new Date(t.createdAt).getTime();
          matchedTokensCount++;
        }
      });

      const avgWaitMinutes = matchedTokensCount > 0 ? Math.round((totalWaitMs / matchedTokensCount) / (1000 * 60)) : 18;
      const avgWaitTimeStr = avgWaitMinutes > 0 ? `${Math.floor(avgWaitMinutes / 60)}h ${avgWaitMinutes % 60}m` : '18m';

      // Staff duty parameters
      const staffOnDutyPercent = totalDoctorsCount > 0 
        ? Math.min(100, Math.round((doctorsOnDutyCount / totalDoctorsCount) * 100))
        : 100;
      const targetPatients = timeFilter === '24h' ? 5 : timeFilter === '7days' ? 20 : 100;
      const patientProgressPercent = Math.min(100, Math.round((periodPatientsCount / targetPatients) * 100));

      // Dynamic chart points generation executed completely with parallel database counts
      const chartData: any[] = [];

      let patientGroups: Array<{ date: Date; count: number }> = [];
      let consultationGroups: Array<{ date: Date; count: number }> = [];

      if (timeFilter === '24h') {
        [patientGroups, consultationGroups] = await Promise.all([
          prisma.$queryRaw<Array<{ date: Date; count: number }>>`
            SELECT DATE_TRUNC('hour', "createdAt") as date, COUNT(*)::integer as count
            FROM "Patient"
            WHERE "createdAt" >= ${startDate}
            GROUP BY DATE_TRUNC('hour', "createdAt")
          `,
          prisma.$queryRaw<Array<{ date: Date; count: number }>>`
            SELECT DATE_TRUNC('hour', "createdAt") as date, COUNT(*)::integer as count
            FROM "Consultation"
            WHERE "createdAt" >= ${startDate}
            GROUP BY DATE_TRUNC('hour', "createdAt")
          `
        ]);

        const slots = [];
        for (let i = 5; i >= 0; i--) {
          const start = new Date(now.getTime() - (i + 1) * 4 * 60 * 60 * 1000);
          const end = new Date(now.getTime() - i * 4 * 60 * 60 * 1000);
          const label = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

          const regCount = patientGroups
            .filter(p => {
              const pTime = new Date(p.date).getTime();
              return pTime >= start.getTime() && pTime < end.getTime();
            })
            .reduce((sum, p) => sum + Number(p.count), 0);

          const consCount = consultationGroups
            .filter(c => {
              const cTime = new Date(c.date).getTime();
              return cTime >= start.getTime() && cTime < end.getTime();
            })
            .reduce((sum, c) => sum + Number(c.count), 0);

          slots.push({ name: label, Registrations: regCount, Consultations: consCount });
        }
        slots.forEach(s => {
          chartData.push(s);
        });
      } else if (timeFilter === '7days') {
        [patientGroups, consultationGroups] = await Promise.all([
          prisma.$queryRaw<Array<{ date: Date; count: number }>>`
            SELECT DATE_TRUNC('day', "createdAt")::date as date, COUNT(*)::integer as count
            FROM "Patient"
            WHERE "createdAt" >= ${startDate}
            GROUP BY DATE_TRUNC('day', "createdAt")
          `,
          prisma.$queryRaw<Array<{ date: Date; count: number }>>`
            SELECT DATE_TRUNC('day', "createdAt")::date as date, COUNT(*)::integer as count
            FROM "Consultation"
            WHERE "createdAt" >= ${startDate}
            GROUP BY DATE_TRUNC('day', "createdAt")
          `
        ]);

        const slots = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const label = d.toLocaleDateString('en-US', { weekday: 'short' });
          const startOfLabelDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
          const endOfLabelDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

          const regCount = patientGroups
            .filter(p => {
              const pTime = new Date(p.date).getTime();
              return pTime >= startOfLabelDay.getTime() && pTime <= endOfLabelDay.getTime();
            })
            .reduce((sum, p) => sum + Number(p.count), 0);

          const consCount = consultationGroups
            .filter(c => {
              const cTime = new Date(c.date).getTime();
              return cTime >= startOfLabelDay.getTime() && cTime <= endOfLabelDay.getTime();
            })
            .reduce((sum, c) => sum + Number(c.count), 0);

          slots.push({ name: label, Registrations: regCount, Consultations: consCount });
        }
        slots.forEach(s => {
          chartData.push(s);
        });
      } else {
        [patientGroups, consultationGroups] = await Promise.all([
          prisma.$queryRaw<Array<{ date: Date; count: number }>>`
            SELECT DATE_TRUNC('day', "createdAt")::date as date, COUNT(*)::integer as count
            FROM "Patient"
            WHERE "createdAt" >= ${startDate}
            GROUP BY DATE_TRUNC('day', "createdAt")
          `,
          prisma.$queryRaw<Array<{ date: Date; count: number }>>`
            SELECT DATE_TRUNC('day', "createdAt")::date as date, COUNT(*)::integer as count
            FROM "Consultation"
            WHERE "createdAt" >= ${startDate}
            GROUP BY DATE_TRUNC('day', "createdAt")
          `
        ]);

        const slots = [];
        for (let i = 5; i >= 0; i--) {
          const start = new Date(now.getTime() - (i + 1) * 5 * 24 * 60 * 60 * 1000);
          const end = new Date(now.getTime() - i * 5 * 24 * 60 * 60 * 1000);
          const label = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          const regCount = patientGroups
            .filter(p => {
              const pTime = new Date(p.date).getTime();
              return pTime >= start.getTime() && pTime < end.getTime();
            })
            .reduce((sum, p) => sum + Number(p.count), 0);

          const consCount = consultationGroups
            .filter(c => {
              const cTime = new Date(c.date).getTime();
              return cTime >= start.getTime() && cTime < end.getTime();
            })
            .reduce((sum, c) => sum + Number(c.count), 0);

          slots.push({ name: label, Registrations: regCount, Consultations: consCount });
        }
        slots.forEach(s => {
          chartData.push(s);
        });
      }

      // Compute Unified System Logs Feed matching client layouts precisely with top 7 events
      const [pLogs, tLogs, cLogs, prLogs, bLogs] = await Promise.all([
        prisma.patient.findMany({ where: whereClause, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
        prisma.token.findMany({ where: whereClause, select: { id: true, tokenNumber: true, createdAt: true, patient: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
        prisma.consultation.findMany({ where: whereClause, select: { id: true, createdAt: true, visitRecord: { select: { token: { select: { tokenNumber: true } } } }, doctor: { select: { name: true } }, patient: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
        prisma.prescription.findMany({ where: whereClause, select: { id: true, createdAt: true, status: true, patient: { select: { name: true } }, items: { select: { medicine: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
        prisma.bill.findMany({ where: whereClause, select: { id: true, createdAt: true, total: true, status: true, patient: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 })
      ]);

      const rawEvents: any[] = [];
      pLogs.forEach(p => {
        rawEvents.push({
          timestamp: p.createdAt.toISOString(),
          action: "Patient Registered",
          subject: `Patient ID #${p.id.slice(-5).toUpperCase()}: ${p.name}`,
          user: "Reception Staff",
          department: "Reception",
          color: "bg-teal-50 text-teal-600 border border-teal-100"
        });
      });
      tLogs.forEach(t => {
        rawEvents.push({
          timestamp: t.createdAt.toISOString(),
          action: "Token Generated",
          subject: `Token #${t.tokenNumber} issued to ${t.patient?.name || "Patient"}`,
          user: "Admissions Desk",
          department: "Reception",
          color: "bg-sky-50 text-sky-600 border border-sky-100"
        });
      });
      cLogs.forEach((c: any) => {
        const tokenNum = c.visitRecord?.token?.tokenNumber || "?";
        const docName = c.doctor?.name ? `Dr. ${c.doctor.name}` : "Doctor";
        rawEvents.push({
          timestamp: c.createdAt.toISOString(),
          action: "Consultation Completed",
          subject: `Token #${tokenNum}: Diagnostic complete for ${c.patient?.name || "Patient"}`,
          user: docName,
          department: "Clinical",
          color: "bg-indigo-50 text-indigo-600 border border-indigo-100"
        });
      });
      prLogs.forEach(p => {
        rawEvents.push({
          timestamp: p.createdAt.toISOString(),
          action: p.status === 'DISPENSED' ? "Prescription Dispensed" : "Prescription Queued",
          subject: `Prescription #${p.id.slice(-6).toUpperCase()} for ${p.patient?.name || "Patient"} (${p.items?.length || 0} items)`,
          user: "Pharmacist Officer",
          department: "Pharmacy",
          color: p.status === 'DISPENSED' ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-orange-50 text-orange-600 border border-orange-100"
        });
      });
      bLogs.forEach(b => {
        const pName = b.patient?.name || "Patient";
        rawEvents.push({
          timestamp: b.createdAt.toISOString(),
          action: "Bill Generated",
          subject: `Invoice #${b.id.slice(-6).toUpperCase()} ($${b.total.toFixed(2)}) for ${pName}`,
          user: "Accounts Clerk",
          department: "Accounts",
          color: "bg-fuchsia-50 text-fuchsia-600 border border-fuchsia-100"
        });
        if (b.status === "PAID") {
          rawEvents.push({
            timestamp: b.createdAt.toISOString(),
            action: "Bill Settled",
            subject: `Settled Invoice #${b.id.slice(-6).toUpperCase()} ($${b.total.toFixed(2)})`,
            user: "Cashier Station",
            department: "Accounts",
            color: "bg-emerald-50 text-emerald-600 border border-emerald-100"
          });
        }
      });

      const unifiedLogsList = rawEvents
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 7);

      // Query Emergency Triage alerts today with fully assignment metrics
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const emergencyTokens = await prisma.token.findMany({
        where: {
          createdAt: { gte: todayStart },
          priority: { in: ['HIGH', 'URGENT', 'EMERGENCY', 'high', 'urgent', 'emergency'] },
          status: { notIn: ['DISPENSED', 'COMPLETED', 'CLOSED', 'CANCELLED', 'DISCHARGED', 'ARCHIVED'] }
        },
        select: {
          id: true,
          tokenNumber: true,
          createdAt: true,
          status: true,
          priority: true,
          patientId: true,
          patient: { select: { id: true, name: true } },
          doctorId: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      });

      const uniqDocIds = Array.from(new Set(emergencyTokens.map(t => t.doctorId).filter(Boolean)));
      const activeDocs = await prisma.user.findMany({
        where: { id: { in: uniqDocIds } },
        select: { id: true, name: true, department: true }
      });

      const emergencyRegistryItems = emergencyTokens.map(t => {
        const doc = activeDocs.find(u => u.id === t.doctorId);
        return {
          token: t,
          patientName: t.patient?.name || "Walk-In Patient",
          tokenNumber: t.tokenNumber,
          doctorName: doc ? `Dr. ${doc.name}` : "Pending assignment",
          department: doc?.department || "Emergency Care",
          priority: t.priority?.toUpperCase() || "HIGH",
          registrationTime: t.createdAt.toISOString(),
          status: t.status
        };
      });

      // Quick-load top 10 bills representing real transactions
      const activeBills = await prisma.bill.findMany({
        where: whereClause,
        select: {
          id: true,
          createdAt: true,
          total: true,
          status: true,
          patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      const summaryData = {
        periodPatientsCount,
        patientProgressPercent,
        doctorsOnDutyCount,
        totalDoctorsCount,
        staffOnDutyPercent,
        avgWaitTimeStr,
        avgWaitMinutes,
        totalBillsGenerated,
        totalPaidBills,
        totalUnpaidBills,
        totalCancelledBills,
        pharmacyRevenueSum,
        consultationsCompletedCount: consultationsCount,
        activeTokensCount,
        prescriptionsDispensedCount,
        chartData,
        unifiedLogsList,
        emergencyRegistryItems,
        activeTransactions: activeBills
      };

      operationalSummaryCache.set(cacheKey, {
        expiry: Date.now() + 60000,
        data: summaryData
      });

      res.json(summaryData);
    } catch (error: any) {
      console.error('Failed to calculate operational summary:', error);
      res.status(500).json({ error: 'Failed to calculate operational summary' });
    }
  });

  // Staff Management
  app.get('/api/users', authenticateJWT, requireRole(['ADMIN', 'RECEPTION', 'DOCTOR']), async (req, res) => {
    try {
      const timezoneOffsetHeader = req.headers['x-timezone-offset'];
      const timezoneOffsetMin = timezoneOffsetHeader ? parseInt(timezoneOffsetHeader as string, 10) : null;
      await checkAndResetDoctorShifts(timezoneOffsetMin);

      const { page, limit, search } = req.query;
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : null;

      const isCacheable = !search && !pageNum && !limitNum;
      const cacheKey = 'users_list_all';
      if (isCacheable) {
        const cached = getCachedData(cacheKey);
        if (cached) return res.json(cached);
      }

      const whereClause: any = { isActive: true };
      if (search) {
        const cleanSearch = String(search).trim();
        whereClause.OR = [
          { name: { contains: cleanSearch, mode: 'insensitive' } },
          { email: { contains: cleanSearch, mode: 'insensitive' } },
          { employeeId: { contains: cleanSearch, mode: 'insensitive' } },
          { designation: { contains: cleanSearch, mode: 'insensitive' } }
        ];
      }

      const selectClause = {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        isActive: true,
        dutyStatus: true,
        lastActivatedAt: true,
        shiftType: true,
        employeeId: true,
        designation: true,
        phone: true,
        dateJoined: true,
        employmentStatus: true,
        notes: true,
        requiresPasswordChange: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        createdAt: true
      };

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [total, data] = await Promise.all([
          prisma.user.count({ where: whereClause }),
          prisma.user.findMany({
            where: whereClause,
            skip,
            take: limitNum,
            select: selectClause
          })
        ]);
        return res.json({
          data,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const users = await prisma.user.findMany({
        where: whereClause,
        select: selectClause
      });
      if (isCacheable) {
        setCachedData(cacheKey, users, 10 * 60 * 1000); // 10 minutes cache
      }
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  app.get('/api/admin/users/:id/attendance-summary', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    try {
      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Fetch all activity logs for this user ascending
      const logs = await prisma.activityLog.findMany({
        where: { userId: id },
        orderBy: { timestamp: 'asc' }
      });

      // Fetch all consultations completed by this doctor (if doctor)
      const consultations = await prisma.consultation.findMany({
        where: { doctorId: id },
        orderBy: { createdAt: 'asc' }
      });

      const settings = await getShiftSettings();
      const timezone = settings.timezone || "Asia/Kolkata";

      // Calculate unique date strings where they were active / logged in
      const presentDaysSet = new Set<string>();

      // 1. Logs: Login logs, duty on logs, any activity log showing active work
      logs.forEach(l => {
        const dateStr = getLocalDateStringInTimezone(l.timestamp, timezone);
        presentDaysSet.add(dateStr);
      });

      // 2. Consultations:
      consultations.forEach(c => {
        const dateStr = getLocalDateStringInTimezone(c.createdAt, timezone);
        presentDaysSet.add(dateStr);
      });

      const presentDays = presentDaysSet.size;

      // Absent Days: Days they were not present in the last 30 days or since joining
      const dateJoined = user.dateJoined ? new Date(user.dateJoined) : new Date();
      const today = new Date();
      const lookbackLimit = new Date();
      lookbackLimit.setDate(today.getDate() - 30);

      // Start counting days from whichever is more recent: dateJoined or 30 days ago
      const startDate = dateJoined > lookbackLimit ? dateJoined : lookbackLimit;
      
      let absentDays = 0;
      const dateList: string[] = [];
      const currentWalk = new Date(startDate);
      const todayStr = getLocalDateStringInTimezone(today, timezone);

      let limit = 0;
      while (getLocalDateStringInTimezone(currentWalk, timezone) <= todayStr && limit < 100) {
        const dStr = getLocalDateStringInTimezone(currentWalk, timezone);
        if (!dateList.includes(dStr)) {
          dateList.push(dStr);
        }
        currentWalk.setDate(currentWalk.getDate() + 1);
        limit++;
      }

      for (const dStr of dateList) {
        if (!presentDaysSet.has(dStr)) {
          absentDays++;
        }
      }

      // Calculate actual total duty hours from duty status logs
      let dutyHours = 0;
      const dutyLogs = logs.filter(l => 
        l.action.toUpperCase().includes('DUTY STATUS UPDATED') ||
        l.action.toUpperCase().includes('DUTY STATUS CLEARED')
      );

      let startedAt: Date | null = null;
      for (const log of dutyLogs) {
        const actionUpper = log.action.toUpperCase();
        if (actionUpper.includes('ON DUTY') || actionUpper.includes('ON_DUTY')) {
          startedAt = log.timestamp;
        } else if ((actionUpper.includes('INACTIVE') || actionUpper.includes('CLEARED') || actionUpper.includes('OFF DUTY')) && startedAt) {
          let endTimestamp = log.timestamp;
          if (
            log.action.toUpperCase().includes('CLEARED') ||
            log.details?.toUpperCase().includes('ENDED AUTOMATICALLY AT CUTOFF') ||
            log.details?.toUpperCase().includes('AUTO_RESET')
          ) {
            const match = log.details?.match(/at cutoff (.*)$/i);
            if (match) {
              const { hour: cutHour, minute: cutMin } = parseTimeString(match[1]);
              const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
              });
              const parts = formatter.formatToParts(startedAt);
              const valOf = (type: string) => {
                const p = parts.find(x => x.type === type);
                return p ? parseInt(p.value, 10) : 0;
              };
              const actYear = valOf('year');
              const actMonth = valOf('month') - 1;
              const actDay = valOf('day');

              const cutoffTimestamp = getLocalDateInTimezone(actYear, actMonth, actDay, cutHour, cutMin, timezone);
              if (cutoffTimestamp > startedAt) {
                endTimestamp = cutoffTimestamp;
              }
            }
          }

          const diffMs = endTimestamp.getTime() - startedAt.getTime();
          dutyHours += diffMs / (1000 * 60 * 60);
          startedAt = null;
        }
      }
      // If currently on duty, add time up to now
      if (startedAt) {
        const diffMs = new Date().getTime() - startedAt.getTime();
        dutyHours += diffMs / (1000 * 60 * 60);
      }

      // Round duty Hours to 1 decimal place
      dutyHours = Math.round(dutyHours * 10) / 10;

      // Consultations Completed
      const consultationsCompleted = consultations.length;

      // Unique Patients Seen
      const patientIds = new Set(consultations.map(c => c.patientId));
      const patientsSeen = patientIds.size;

      // Prescriptions dispensed (Pharmacist)
      const prescriptionsDispensed = await prisma.pharmacyDispensingLog.count({
        where: { pharmacistId: id }
      });

      // Tokens issued (calculated from ActivityLogs recorded by receptionist)
      const tokensIssued = logs.filter(l => 
        l.action.toUpperCase().includes('TOKEN GENERATED') ||
        l.action.toUpperCase().includes('TOKEN CREATED') ||
        l.action.toUpperCase().includes('PATIENT VISIT')
      ).length;

      res.json({
        presentDays,
        absentDays,
        dutyHours,
        consultationsCompleted,
        patientsSeen,
        prescriptionsDispensed,
        tokensIssued,
        hasActivity: logs.length > 0 || consultations.length > 0
      });
    } catch (error: any) {
      console.error('Error fetching attendance summary for user:', error);
      res.status(500).json({ error: 'Failed to calculate attendance summary' });
    }
  });

  app.post('/api/users', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    const { email, password, name, role, department, employeeId, designation, phone, dateJoined, employmentStatus, notes, shiftType, dutyStatus, pin, addressLine1, addressLine2, city, state, postalCode, country } = req.body;
    try {
      // Validate mandatory Employee ID
      if (!employeeId || !employeeId.trim() || employeeId.trim().toUpperCase() === 'N/A') {
        return res.status(400).json({ error: 'Employee ID is mandatory and cannot be empty or N/A.' });
      }

      if (email && email.trim()) {
        const existing = await prisma.user.findUnique({
          where: { email }
        });
        if (existing) {
          return res.status(400).json({ error: 'A staff member with this email already exists.' });
        }
      }

      const existingEmp = await prisma.user.findUnique({
        where: { employeeId: employeeId.trim() }
      });
      if (existingEmp) {
        return res.status(400).json({ error: 'A staff member with this Employee ID already exists.' });
      }

      const userData: any = {
        name,
        role,
        department: department || 'General Medicine',
        isActive: true,
        dutyStatus: dutyStatus || 'INACTIVE',
        shiftType: shiftType || 'MORNING',
        email: (role === 'DOCTOR' && email && email.trim()) ? email.trim() : null,
        employeeId: employeeId.trim(),
        addressLine1: addressLine1 && addressLine1.trim() ? addressLine1.trim() : null,
        addressLine2: addressLine2 && addressLine2.trim() ? addressLine2.trim() : null,
        city: city && city.trim() ? city.trim() : null,
        state: state && state.trim() ? state.trim() : null,
        postalCode: postalCode && postalCode.trim() ? postalCode.trim() : null,
        country: country && country.trim() ? country.trim() : null,
        designation: designation && designation.trim() ? designation.trim() : null,
        phone: phone && phone.trim() ? phone.trim() : null,
        dateJoined: dateJoined ? new Date(dateJoined) : new Date(),
        employmentStatus: employmentStatus || 'ACTIVE',
        notes: notes && notes.trim() ? notes.trim() : null,
        pin: (role === 'DOCTOR' && pin && pin.trim()) ? pin.trim() : null,
        requiresPasswordChange: false
      };

      if (role === 'DOCTOR' && password && password.trim()) {
        userData.password = await hashPassword(password);
      } else {
        userData.password = null;
      }

      const user = await prisma.user.create({
        data: userData
      });
      invalidateCachedData('users_list_all');
      res.json(user);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to create user' });
    }
  });

  app.put('/api/users/:id', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    const { email, password, name, role, department, employeeId, designation, phone, dateJoined, employmentStatus, notes, shiftType, dutyStatus, pin, requiresPasswordChange, addressLine1, addressLine2, city, state, postalCode, country } = req.body;
    try {
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (role !== undefined) updateData.role = role;
      if (department !== undefined) updateData.department = department;
      if (designation !== undefined) updateData.designation = designation;
      if (phone !== undefined) updateData.phone = phone;
      if (employmentStatus !== undefined) updateData.employmentStatus = employmentStatus;
      if (notes !== undefined) updateData.notes = notes;
      if (shiftType !== undefined) updateData.shiftType = shiftType;
      if (dutyStatus !== undefined) updateData.dutyStatus = dutyStatus;
      if (requiresPasswordChange !== undefined) updateData.requiresPasswordChange = requiresPasswordChange;
      if (addressLine1 !== undefined) updateData.addressLine1 = addressLine1 && addressLine1.trim() ? addressLine1.trim() : null;
      if (addressLine2 !== undefined) updateData.addressLine2 = addressLine2 && addressLine2.trim() ? addressLine2.trim() : null;
      if (city !== undefined) updateData.city = city && city.trim() ? city.trim() : null;
      if (state !== undefined) updateData.state = state && state.trim() ? state.trim() : null;
      if (postalCode !== undefined) updateData.postalCode = postalCode && postalCode.trim() ? postalCode.trim() : null;
      if (country !== undefined) updateData.country = country && country.trim() ? country.trim() : null;

      if (dateJoined !== undefined) {
        updateData.dateJoined = dateJoined ? new Date(dateJoined) : null;
      }

      if (employeeId !== undefined) {
        if (!employeeId || !employeeId.trim() || employeeId.trim().toUpperCase() === 'N/A') {
          return res.status(400).json({ error: 'Employee ID is mandatory and cannot be empty or N/A.' });
        }
        updateData.employeeId = employeeId.trim();
        const existingEmp = await prisma.user.findFirst({
          where: { employeeId: updateData.employeeId, NOT: { id: req.params.id } }
        });
        if (existingEmp) {
          return res.status(400).json({ error: 'A staff member with this Employee ID already exists.' });
        }
      }

      // Check final role for credential clearance
      let finalRole = role;
      if (!finalRole) {
        const existingUser = await prisma.user.findUnique({ where: { id: req.params.id } });
        finalRole = existingUser?.role;
      }

      if (finalRole !== 'DOCTOR') {
        updateData.email = null;
        updateData.password = null;
        updateData.pin = null;
      } else {
        if (pin !== undefined) updateData.pin = pin && pin.trim() ? pin.trim() : null;
        if (email !== undefined) {
          updateData.email = email && email.trim() ? email.trim() : null;
          if (updateData.email) {
            const existing = await prisma.user.findFirst({
              where: { email: updateData.email, NOT: { id: req.params.id } }
            });
            if (existing) {
              return res.status(400).json({ error: 'A staff member with this email already exists.' });
            }
          }
        }
        if (password !== undefined) {
          if (password && password.trim()) {
            const isAlreadyHashed = password.startsWith('$2a$') || password.startsWith('$2b$') || password.startsWith('$2y$');
            if (!isAlreadyHashed) {
              updateData.password = await hashPassword(password);
            } else {
              updateData.password = password;
            }
          } else {
            updateData.password = null;
          }
        }
      }

      const preUser = await prisma.user.findUnique({
        where: { id: req.params.id }
      });

      if (preUser && preUser.role === 'DOCTOR' && dutyStatus !== undefined && dutyStatus !== preUser.dutyStatus) {
        if (dutyStatus === 'ON DUTY' || dutyStatus === 'ON_DUTY') {
          updateData.lastActivatedAt = new Date();
        }
      }

      const user = await prisma.user.update({
        where: { id: req.params.id },
        data: updateData
      });

      if (preUser && preUser.role === 'DOCTOR' && dutyStatus !== undefined && dutyStatus !== preUser.dutyStatus) {
        const logAction = (user.dutyStatus === 'ON DUTY' || user.dutyStatus === 'ON_DUTY') ? 'DUTY_ON' : 'DUTY_OFF_MANUAL';
        const logSource = (user.dutyStatus === 'ON DUTY' || user.dutyStatus === 'ON_DUTY') ? `MANUAL_ON | Shift: ${user.shiftType}` : 'ADMIN_FORCE_OFF';
        await prisma.activityLog.create({
          data: {
            userId: user.id,
            userName: user.name,
            action: logAction,
            details: logSource,
            timestamp: new Date()
          }
        });
      }

      invalidateCachedData('users_list_all');
      res.json(user);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to update user' });
    }
  });

  // PUT /api/users/:id/duty
  app.put('/api/users/:id/duty', authenticateJWT, requireRole(['DOCTOR', 'ADMIN']), async (req: any, res: any) => {
    const { id } = req.params;
    const { dutyStatus, shiftType } = req.body;
    try {
      const isDoctor = req.user.role === 'DOCTOR';
      if (isDoctor && req.user.userId !== id) {
        return res.status(403).json({ error: 'Forbidden: Doctors may only update their own duty status.' });
      }

      let finalShiftType = shiftType;
      let lastActivatedAt = null;

      if (dutyStatus === 'ON DUTY' || dutyStatus === 'ON_DUTY') {
        lastActivatedAt = new Date();
        if (!finalShiftType) {
          const settings = await getShiftSettings();
          const timezone = settings.timezone || "Asia/Kolkata";
          const parsedMorning = parseTimeString(settings.morningShiftEnd);
          const parsedEvening = parseTimeString(settings.eveningShiftEnd);
          const serverLocal = getLocalTimeInTimezone(timezone);
          const currentMinutes = serverLocal.hour * 60 + serverLocal.minute;
          const morningEndMin = parsedMorning.hour * 60 + parsedMorning.minute;
          const eveningEndMin = parsedEvening.hour * 60 + parsedEvening.minute;
          
          if (currentMinutes < morningEndMin) {
            finalShiftType = 'MORNING';
          } else if (currentMinutes < eveningEndMin) {
            finalShiftType = 'EVENING';
          } else {
            finalShiftType = 'MORNING';
          }
        }
      }

      const updatePayload: any = {
        dutyStatus: dutyStatus === 'ON DUTY' ? 'ON DUTY' : 'INACTIVE'
      };
      if (dutyStatus === 'ON DUTY') {
        updatePayload.lastActivatedAt = lastActivatedAt;
      }
      if (dutyStatus === 'ON DUTY') {
        updatePayload.shiftType = finalShiftType;
      } else if (shiftType) {
        updatePayload.shiftType = shiftType;
      }

      const user = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id },
          data: updatePayload
        });

        const isSelf = (req.user.userId === id);
        let logAction = '';
        let logSource = '';
        if (updatedUser.dutyStatus === 'ON DUTY') {
          logAction = 'DUTY_ON';
          logSource = `MANUAL_ON | Shift: ${updatedUser.shiftType}`;
        } else {
          logAction = 'DUTY_OFF_MANUAL';
          logSource = isSelf ? 'MANUAL_OFF' : 'ADMIN_FORCE_OFF';
        }

        await tx.activityLog.create({
          data: {
            userId: updatedUser.id,
            userName: updatedUser.name,
            action: logAction,
            details: logSource,
            timestamp: new Date()
          }
        });

        return updatedUser;
      });

      invalidateCachedData('users_list_all');
      res.json(user);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update duty status.' });
    }
  });

  // GET /api/duty-settings
  app.get('/api/duty-settings', authenticateJWT, requireRole(['ADMIN', 'DOCTOR']), async (req, res) => {
    try {
      const cacheKey = 'duty-settings';
      const cached = getCachedData(cacheKey);
      if (cached) return res.json(cached);

      const settings = await getShiftSettings();
      setCachedData(cacheKey, settings, 10 * 60 * 1000);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch duty settings.' });
    }
  });

  // POST /api/duty-settings
  app.post('/api/duty-settings', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    const { morningShiftEnd, eveningShiftEnd, timezone } = req.body;
    try {
      const payload = {
        morningShiftEnd: morningShiftEnd || "01:00 PM",
        eveningShiftEnd: eveningShiftEnd || "08:00 PM",
        timezone: timezone || "Asia/Kolkata"
      };

      const settings = await prisma.dutySetting.upsert({
        where: { id: 'singleton' },
        update: {
          morningShiftEnd: payload.morningShiftEnd,
          eveningShiftEnd: payload.eveningShiftEnd,
          timezone: payload.timezone
        },
        create: {
          id: 'singleton',
          morningShiftEnd: payload.morningShiftEnd,
          eveningShiftEnd: payload.eveningShiftEnd,
          timezone: payload.timezone
        }
      });

      // Maintain a file backup in case there's any fallback
      try {
        const settingsPath = path.join(process.cwd(), 'src/lib/dutySettings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(payload, null, 2), 'utf8');
      } catch (fileErr) {
        console.warn('Failed to write duty settings backup file:', fileErr);
      }

      invalidateCachedData('duty-settings');
      res.json({ success: true, settings });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to save duty settings.' });
    }
  });

  // GET /api/departments
  app.get('/api/departments', authenticateJWT, async (req, res) => {
    try {
      const cacheKey = 'departments';
      const cached = getCachedData(cacheKey);
      if (cached) return res.json(cached);

      let depts = await prisma.department.findMany({
        orderBy: { name: 'asc' }
      });
      if (depts.length === 0) {
        const defaultDepartments = [
          'Cardiology',
          'General Medicine',
          'Pediatrics',
          'Orthopedics',
          'Pharmacy',
          'Reception',
          'Laboratory',
          'Billing',
          'Administration',
          'Oncology',
          'Neurology',
          'Emergency',
          'Diagnostics'
        ];
        await prisma.department.createMany({
          data: defaultDepartments.map(name => ({ name })),
          skipDuplicates: true
        });
        depts = await prisma.department.findMany({
          orderBy: { name: 'asc' }
        });
      }
      setCachedData(cacheKey, depts, 15 * 60 * 1000);
      res.json(depts);
    } catch (error) {
      console.error('Failed to fetch departments:', error);
      res.status(500).json({ error: 'Failed to fetch departments' });
    }
  });

  // POST /api/departments
  app.post('/api/departments', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }
    try {
      const formattedName = name.trim();
      const existing = await prisma.department.findUnique({
        where: { name: formattedName }
      });
      if (existing) {
        return res.status(400).json({ error: 'Department already exists' });
      }
      const dept = await prisma.department.create({
        data: { name: formattedName }
      });
      invalidateCachedData('departments');
      res.json(dept);
    } catch (error) {
      console.error('Failed to create department:', error);
      res.status(500).json({ error: 'Failed to create department' });
    }
  });

  app.delete('/api/users/:id', authenticateJWT, requireRole(['ADMIN']), async (req, res) => {
    try {
      // 0. Ensure only non-protected users can be deleted
      const targetUser = await prisma.user.findUnique({
        where: { id: req.params.id }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const protectedEmails = ['admin@hospital.com', 'reception@hospital.com', 'pharmacy@hospital.com'];
      const protectedNames = ['System Admin', 'Reception Desk', 'Pharmacy Head'];
      const protectedEmpIds = ['ADM-1001', 'REC-1001', 'PHR-1001'];

      if (
        protectedEmails.includes(targetUser.email || '') || 
        protectedNames.includes(targetUser.name || '') ||
        protectedEmpIds.includes(targetUser.employeeId || '')
      ) {
        return res.status(400).json({ 
          error: 'Crucial system accounts (System Admin, Reception Desk, and Pharmacy Head) are protected and cannot be deleted.' 
        });
      }

      // 1. Check for active assignments if user is a DOCTOR
      if (targetUser.role === 'DOCTOR') {
        const activeAssignments = await prisma.doctorQueue.findFirst({
          where: {
            doctorId: req.params.id,
            status: { in: ['WAITING', 'IN_CONSULTATION'] }
          }
        });

        if (activeAssignments) {
          return res.status(400).json({ 
            error: 'This doctor currently has active patient assignments. Reassign or complete those consultations before deletion.' 
          });
        }
      }

      // 2. Soft delete the user
      const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { isActive: false }
      });

      // Write in audit trail
      try {
        await prisma.activityLog.create({
          data: {
            action: 'DELETE_STAFF',
            userName: (req as any).user?.name || 'Admin',
            details: `Staff member '${targetUser.name}' (ID: ${targetUser.employeeId || 'N/A'}, Role: ${targetUser.role}) has been deactivated/deleted.`,
            userId: (req as any).user?.userId ? String((req as any).user.userId) : undefined
          }
        });
      } catch (logErr) {
        console.error('Failed to write deletion activity log', logErr);
      }

      invalidateCachedData('users_list_all');
      res.json({ message: 'User account deactivated successfully', user });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // Activity Logs API
  app.get('/api/activity-logs', authenticateJWT, requireRole(['ADMIN', 'RECEPTION', 'DOCTOR', 'PHARMACY']), async (req, res) => {
    try {
      const { page, limit } = req.query;
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : null;

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [total, logs] = await Promise.all([
          prisma.activityLog.count(),
          prisma.activityLog.findMany({
            orderBy: { timestamp: 'desc' },
            skip,
            take: limitNum
          })
        ]);
        const mappedLogs = logs.map(l => ({
          id: l.id,
          action: l.action,
          user: l.userName || 'System',
          timestamp: l.timestamp.toISOString(),
          details: l.details || ''
        }));
        return res.json({
          data: mappedLogs,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const logs = await prisma.activityLog.findMany({
        orderBy: { timestamp: 'desc' },
        take: 50
      });
      const mappedLogs = logs.map(l => ({
        id: l.id,
        action: l.action,
        user: l.userName || 'System',
        timestamp: l.timestamp.toISOString(),
        details: l.details || ''
      }));
      res.json(mappedLogs);
    } catch (error) {
      console.error('Failed to fetch activity logs:', error);
      res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
  });

  app.post('/api/activity-logs', authenticateJWT, requireRole(['ADMIN', 'RECEPTION', 'DOCTOR', 'PHARMACY']), async (req, res) => {
    const { action, details } = req.body;
    try {
      const resolvedUserId = (req as any).user?.userId;
      if (!resolvedUserId) {
        return res.status(401).json({ error: 'Unauthorized: No user session found.' });
      }

      // Fetch user from DB to get the certified userName
      const activeUser = await prisma.user.findUnique({
        where: { id: resolvedUserId }
      });

      const newLog = await prisma.activityLog.create({
        data: {
          action: String(action),
          userName: activeUser?.name || 'System',
          details: details ? String(details) : undefined,
          userId: resolvedUserId
        }
      });
      res.json({
        id: newLog.id,
        action: newLog.action,
        user: newLog.userName,
        timestamp: newLog.timestamp.toISOString(),
        details: newLog.details || ''
      });
    } catch (error) {
      console.error('Failed to create activity log:', error);
      res.status(500).json({ error: 'Failed to create activity log' });
    }
  });

  // Patients
  app.get('/api/patients', authenticateJWT, requireRole(['RECEPTION', 'DOCTOR', 'PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    const { search, page, limit, dateFilter, startDate, endDate } = req.query;
    try {
      const searchStr = search ? String(search).trim() : '';
      const isDoctor = req.user.role === 'DOCTOR';
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : null;

      let dateClause: any = null;
      if (dateFilter) {
        if (dateFilter === 'today') {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          dateClause = { gte: todayStart };
        } else if (dateFilter === 'week') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          weekAgo.setHours(0, 0, 0, 0);
          dateClause = { gte: weekAgo };
        } else if (dateFilter === 'month') {
          const monthAgo = new Date();
          monthAgo.setDate(monthAgo.getDate() - 30);
          monthAgo.setHours(0, 0, 0, 0);
          dateClause = { gte: monthAgo };
        } else if (dateFilter === 'custom' && startDate) {
          const sDate = new Date(String(startDate));
          sDate.setHours(0, 0, 0, 0);
          const eDate = endDate ? new Date(String(endDate)) : new Date();
          eDate.setHours(23, 59, 59, 999);
          dateClause = { gte: sDate, lte: eDate };
        }
      }

      const whereClause: any = {
        AND: [
          searchStr ? {
            OR: [
              { id: { contains: searchStr, mode: 'insensitive' } },
              { name: { contains: searchStr, mode: 'insensitive' } },
              { phone: { contains: searchStr } }
            ]
          } : {},
          isDoctor ? {
            consultations: {
              some: {
                doctorId: req.user.userId,
                ...(dateClause ? { createdAt: dateClause } : {})
              }
            }
          } : (dateClause ? {
            createdAt: dateClause
          } : {})
        ]
      };

      const includeClause: any = {
        tokens: {
          orderBy: { createdAt: 'desc' as const },
          take: 1
        },
        consultations: {
          where: isDoctor ? { doctorId: req.user.userId } : {},
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          include: {
            doctor: {
              select: { name: true, department: true }
            }
          }
        }
      };

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [total, data] = await Promise.all([
          prisma.patient.count({ where: whereClause }),
          prisma.patient.findMany({
            where: whereClause,
            include: includeClause,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limitNum
          })
        ]);
        return res.json({
          data,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const patients = await prisma.patient.findMany({
        where: whereClause,
        include: includeClause,
        orderBy: {
          createdAt: 'desc'
        },
        take: 100
      });
      res.json(patients);
    } catch (error) {
      console.error('Error fetching patients:', error);
      res.status(500).json({ error: 'Failed to fetch patients' });
    }
  });

  app.get('/api/export/patients', authenticateJWT, requireRole(['RECEPTION', 'DOCTOR', 'PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    try {
      const isDoctor = req.user.role === 'DOCTOR';
      const whereClause: any = {
        AND: [
          isDoctor ? {
            consultations: {
              some: { doctorId: req.user.userId }
            }
          } : {}
        ]
      };

      const includeClause: any = {
        tokens: {
          orderBy: { createdAt: 'desc' as const },
          take: 1
        },
        consultations: {
          where: isDoctor ? { doctorId: req.user.userId } : {},
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          include: {
            doctor: {
              select: { name: true, department: true }
            }
          }
        }
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.write('[');

      let skip = 0;
      const batchSize = 1000;
      let hasMore = true;
      let isFirst = true;

      while (hasMore) {
        const batch = await prisma.patient.findMany({
          where: whereClause,
          include: includeClause,
          orderBy: {
            createdAt: 'desc'
          },
          skip: skip,
          take: batchSize
        });

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        for (const item of batch) {
          if (!isFirst) {
            res.write(',');
          } else {
            isFirst = false;
          }
          res.write(JSON.stringify(item));
        }

        skip += batch.length;
        if (batch.length < batchSize) {
          hasMore = false;
        }

        await new Promise((resolve) => setImmediate(resolve));
      }

      res.write(']');
      res.end();
    } catch (error) {
      console.error('Error exporting patients:', error);
      if (res.headersSent) {
        res.end();
      } else {
        res.status(500).json({ error: 'Failed to export patients' });
      }
    }
  });

  app.get('/api/patients/:id', authenticateJWT, requireRole(['RECEPTION', 'DOCTOR', 'PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    try {
      const isDoctor = req.user.role === 'DOCTOR';
      if (isDoctor) {
        const patientId = req.params.id;
        const doctorId = req.user.userId;

        const [hasConsultation, hasAppointment, hasToken] = await Promise.all([
          prisma.consultation.findFirst({ where: { patientId, doctorId } }),
          prisma.appointment.findFirst({ where: { patientId, doctorId } }),
          prisma.token.findFirst({ where: { patientId, doctorId } })
        ]);

        if (!hasConsultation && !hasAppointment && !hasToken) {
          return res.status(403).json({ error: 'Forbidden: You are not authorized to access this patient\'s records.' });
        }
      }

      const patient = await prisma.patient.findUnique({
        where: { id: req.params.id },
        include: {
          tokens: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          consultations: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      const activeUser = await prisma.user.findUnique({
        where: { id: req.user.userId }
      });

      await prisma.activityLog.create({
        data: {
          userId: req.user.userId,
          userName: activeUser?.name || 'Staff User',
          action: 'PATIENT_OPENED',
          details: `Opened patient record: ${patient.name} (ID: ${patient.id})`
        }
      });

      res.json(patient);
    } catch (error) {
      console.error('Error fetching patient:', error);
      res.status(500).json({ error: 'Failed to fetch patient' });
    }
  });

  app.post('/api/patients', authenticateJWT, requireRole(['RECEPTION', 'ADMIN']), async (req, res) => {
    try {
      const { name, phone, dateOfBirth, email } = req.body;

      if (phone && name) {
        const parsedDob = dateOfBirth ? new Date(dateOfBirth) : null;
        const formattedDob = parsedDob && !isNaN(parsedDob.getTime()) ? parsedDob : null;

        const existingPatient = await prisma.patient.findFirst({
          where: {
            name: { equals: name, mode: 'insensitive' },
            phone: phone,
            ...(formattedDob && { dateOfBirth: formattedDob }),
          }
        });

        if (existingPatient) {
          return res.status(400).json({ error: 'A patient with this name, phone number, and Date of Birth is already registered.' });
        }
      }

      // Generate custom unique human Patient ID (e.g. PAT-59281)
      let patient;
      let retries = 0;
      while (retries < 5) {
        let patientId = `PAT-${Math.floor(10000 + Math.random() * 90000)}`;
        let exists = await prisma.patient.findUnique({ where: { id: patientId } });
        while (exists) {
          patientId = `PAT-${Math.floor(10000 + Math.random() * 90000)}`;
          exists = await prisma.patient.findUnique({ where: { id: patientId } });
        }

        const patientData = {
          ...req.body,
          id: patientId,
          age: req.body.age ? parseInt(req.body.age.toString()) : 30,
          dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : null
        };

        try {
          patient = await prisma.patient.create({
            data: patientData
          });
          break; // Success!
        } catch (err: any) {
          if (err.code === 'P2002') {
            retries++;
            continue; // ID collision, retry with new random ID
          }
          throw err;
        }
      }

      if (!patient) {
        return res.status(500).json({ error: 'Failed to generate a unique Patient ID after multiple retries.' });
      }
      res.json(patient);
    } catch (error) {
      console.error('Error creating patient:', error);
      res.status(500).json({ error: 'Failed to create patient' });
    }
  });

  app.put('/api/patients/:id', authenticateJWT, requireRole(['RECEPTION', 'DOCTOR', 'ADMIN']), async (req, res) => {
    try {
      const { id } = req.params;
      const { ...updateData } = req.body;
      
      if (updateData.age !== undefined && updateData.age !== null) {
        updateData.age = parseInt(updateData.age.toString());
      }
      if (updateData.dateOfBirth) {
        updateData.dateOfBirth = new Date(updateData.dateOfBirth);
      }
      
      const updated = await prisma.patient.update({
        where: { id },
        data: updateData
      });
      res.json(updated);
    } catch (error) {
      console.error('Error updating patient:', error);
      res.status(500).json({ error: 'Failed to update patient profile' });
    }
  });

  // Appointments & Tokens
  app.post('/api/appointments', authenticateJWT, requireRole(['RECEPTION', 'ADMIN']), async (req, res) => {
    const { patientId, doctorId, date, time, priority } = req.body;
    try {
      // 1. Check for duplicate active queue entry
      const existingQueueEntry = await prisma.doctorQueue.findFirst({
        where: {
          patientId,
          doctorId,
          status: { in: ['WAITING', 'IN_CONSULTATION'] }
        }
      });

      if (existingQueueEntry) {
        return res.status(400).json({ 
          error: 'Patient is already in the queue for this doctor.',
          existingTokenId: existingQueueEntry.tokenId
        });
      }

      // Fetch doctor department to determine token prefix
      const doctorUser = await prisma.user.findUnique({
        where: { id: doctorId }
      });
      const dept = doctorUser?.department || 'General Medicine';
      let prefix = 'GM';
      if (dept.toLowerCase().includes('cardio')) {
        prefix = 'CA';
      } else if (dept.toLowerCase().includes('pediatric')) {
        prefix = 'PD';
      } else if (dept.toLowerCase().includes('derm')) {
        prefix = 'DM';
      } else if (dept.toLowerCase().includes('diag')) {
        prefix = 'DI';
      } else if (dept.toLowerCase().includes('emerg')) {
        prefix = 'EG';
      }

      const result = await prisma.$transaction(async (tx) => {
        // Generate Token Number like GM-1042
        let tokenNumber = '';
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
          attempts++;
          const randomNumber = Math.floor(1000 + Math.random() * 9000);
          tokenNumber = `${prefix}-${randomNumber}`;
          const existingToken = await tx.token.findUnique({
            where: { tokenNumber }
          });
          if (!existingToken) {
            isUnique = true;
          }
        }

        if (!isUnique) {
          // Fallback if random clashes
          const timestamp = Date.now().toString().slice(-4);
          tokenNumber = `${prefix}-${timestamp}`;
        }

        const appointment = await tx.appointment.create({
          data: { patientId, doctorId, date: new Date(date), time, status: 'WAITING' }
        });

        const token = await tx.token.create({
          data: { 
            tokenNumber, 
            patientId, 
            doctorId, 
            status: 'WAITING',
            priority: priority ? priority.toUpperCase() : 'MEDIUM'
          }
        });

        // Create Doctor Queue entry
        const queueEntry = await tx.doctorQueue.create({
          data: {
            patientId,
            doctorId,
            appointmentId: appointment.id,
            tokenId: token.id,
            status: 'WAITING'
          }
        });

        // Create initial visit record
        const visit = await tx.visitRecord.create({
          data: { patientId, doctorId, tokenId: token.id }
        });

        return { appointment, token, queueEntry, visit };
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to create appointment' });
    }
  });

  app.get('/api/tokens', authenticateJWT, requireRole(['RECEPTION', 'DOCTOR', 'PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    let { doctorId, status, page, limit, patientId, today, active, search } = req.query;
    
    // Strict boundary: A Doctor must only see their own assigned queue/tokens, derived securely from JWT.
    if (req.user.role === 'DOCTOR') {
      doctorId = req.user.userId;
    }

    try {
      const timezoneOffsetHeader = req.headers['x-timezone-offset'];
      const timezoneOffsetMin = timezoneOffsetHeader ? parseInt(timezoneOffsetHeader as string, 10) : null;
      await checkAndResetDoctorShifts(timezoneOffsetMin);
      
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : null;
      const statusArray = status ? String(status).split(',') : undefined;

      const whereClause: any = {
        ...(doctorId && { doctorId: String(doctorId) }),
        ...(patientId && { patientId: String(patientId) }),
        ...(statusArray && { status: { in: statusArray } })
      };

      if (today === 'true') {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        whereClause.createdAt = {
          gte: startOfToday
        };
      }

      if (active === 'true') {
        whereClause.status = {
          in: ['WAITING', 'IN_CONSULTATION']
        };
      }

      if (search) {
        const cleanSearch = String(search).trim();
        whereClause.AND = [
          ...(whereClause.AND || []),
          {
            OR: [
              { tokenNumber: { contains: cleanSearch, mode: 'insensitive' } },
              { patient: { name: { contains: cleanSearch, mode: 'insensitive' } } },
              { patient: { phone: { contains: cleanSearch } } }
            ]
          }
        ];
      }

      const includeClause = { 
        patient: {
          select: {
            id: true,
            name: true,
            phone: true,
            age: true,
            gender: true,
            medicalHistory: true,
            chronicConditions: true,
            allergies: true,
            createdAt: true
          }
        },
        doctorQueue: {
          select: {
            id: true
          }
        },
        visitRecord: {
          select: {
            id: true,
            consultation: {
              select: {
                id: true,
                prescription: {
                  select: {
                    id: true,
                    items: {
                      select: {
                        id: true,
                        medicine: true,
                        dosage: true,
                        frequency: true,
                        duration: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [total, data] = await Promise.all([
          prisma.token.count({ where: whereClause }),
          prisma.token.findMany({
            where: whereClause,
            include: includeClause,
            orderBy: { createdAt: 'asc' },
            skip,
            take: limitNum
          })
        ]);
        return res.json({
          data,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const tokens = await prisma.token.findMany({
        where: whereClause,
        include: includeClause,
        orderBy: { createdAt: 'asc' },
        take: 1000
      });
      res.json(tokens);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tokens' });
    }
  });

  app.get('/api/export/tokens', authenticateJWT, requireRole(['RECEPTION', 'DOCTOR', 'PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    let doctorId = undefined;
    if (req.user.role === 'DOCTOR') {
      doctorId = req.user.userId;
    }

    const { startDate, endDate } = req.query;

    if (startDate && isNaN(Date.parse(String(startDate)))) {
      return res.status(400).json({ 
        error: 'Date parsing failed', 
        reason: `Invalid format for startDate: "${startDate}". Expected format YYYY-MM-DD.` 
      });
    }

    if (endDate && isNaN(Date.parse(String(endDate)))) {
      return res.status(400).json({ 
        error: 'Date parsing failed', 
        reason: `Invalid format for endDate: "${endDate}". Expected format YYYY-MM-DD.` 
      });
    }

    let start: Date | undefined;
    let end: Date | undefined;

    if (startDate) {
      start = new Date(String(startDate));
      start.setHours(0, 0, 0, 0);
    }
    if (endDate) {
      end = new Date(String(endDate));
      end.setHours(23, 59, 59, 999);
    }

    if (start && end && start > end) {
      return res.status(400).json({ 
        error: 'Invalid range', 
        reason: `startDate (${startDate}) cannot be after endDate (${endDate}).` 
      });
    }

    try {
      const whereClause: any = {
        ...(doctorId && { doctorId: String(doctorId) })
      };

      if (start && end) {
        whereClause.createdAt = {
          gte: start,
          lte: end
        };
      }

      const includeClause = { 
        patient: true,
        doctorQueue: true,
        visitRecord: {
          include: {
            consultation: {
              include: {
                prescription: {
                  include: {
                    items: true
                  }
                }
              }
            }
          }
        }
      };

      // 1. Calculate operational metrics efficiently using index-backed Prisma aggregate/count queries
      const matchingTokensCount = await prisma.token.count({ where: whereClause });

      if (matchingTokensCount === 0) {
        return res.status(404).json({
          error: 'No tokens found',
          reason: `No queue entry tokens were found matching the filters within 'Token' active database table for selected date span: ${startDate || 'all'} to ${endDate || 'all'}. (No matching records on 'createdAt' date column; Status is verified, but 0 records exist).`
        });
      }

      const consultationsCount = await prisma.token.count({
        where: {
          ...whereClause,
          visitRecord: {
            consultation: { isNot: null }
          }
        }
      });

      const completedVisitsCount = await prisma.token.count({
        where: {
          ...whereClause,
          OR: [
            { status: 'COMPLETED' },
            { visitRecord: { isNot: null } }
          ]
        }
      });

      const doctorsGroup = await prisma.token.groupBy({
        by: ['doctorId'],
        where: {
          ...whereClause,
          doctorId: { not: '' }
        }
      });
      const assignedDoctorsCount = doctorsGroup.length;

      console.log('HIGH FIBRE EXPORT METRICS RESOLVED:', {
        matchingTokensCount,
        consultationsCount,
        completedVisitsCount,
        assignedDoctorsCount
      });

      // 2. Set metrics headers
      res.setHeader('x-matching-tokens-count', String(matchingTokensCount));
      res.setHeader('x-consultation-count', String(consultationsCount));
      res.setHeader('x-completed-visits-count', String(completedVisitsCount));
      res.setHeader('x-assigned-doctors-count', String(assignedDoctorsCount));

      // 3. Stream back JSON array in cursorless batches to avoid OOM heap crash under load
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.write('[');

      let skip = 0;
      const batchSize = 1000;
      let hasMore = true;
      let isFirst = true;

      while (hasMore) {
        const batch = await prisma.token.findMany({
          where: whereClause,
          include: includeClause,
          orderBy: { createdAt: 'asc' },
          skip: skip,
          take: batchSize
        });

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        for (const item of batch) {
          if (!isFirst) {
            res.write(',');
          } else {
            isFirst = false;
          }
          res.write(JSON.stringify(item));
        }

        skip += batch.length;
        if (batch.length < batchSize) {
          hasMore = false;
        }

        // prevent holding event loop blockages under ultra large loops
        await new Promise((resolve) => setImmediate(resolve));
      }

      res.write(']');
      res.end();
    } catch (error) {
      console.error('Failed to export tokens:', error);
      if (res.headersSent) {
        res.end();
      } else {
        res.status(500).json({ error: 'Failed to export tokens' });
      }
    }
  });

  app.patch('/api/tokens/:id', authenticateJWT, requireRole(['RECEPTION', 'DOCTOR', 'ADMIN']), async (req: any, res: any) => {
    const { status, priority } = req.body;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existingToken = await tx.token.findUnique({
          where: { id: req.params.id }
        });

        if (!existingToken) {
          throw new Error('Token not found');
        }

        // Strict boundary: A Doctor must only be able to update status of their own assigned tokens/queue.
        if (req.user.role === 'DOCTOR' && existingToken.doctorId !== req.user.userId) {
          throw new Error('Unauthorized: You are not assigned to this token/patient.');
        }

        const updateData: any = {};
        if (status !== undefined) updateData.status = status;
        if (priority !== undefined) updateData.priority = priority.toUpperCase();

        const token = await tx.token.update({
          where: { id: req.params.id },
          data: updateData
        });

        if (status !== undefined) {
          await tx.doctorQueue.updateMany({
            where: { tokenId: req.params.id },
            data: { status }
          });
        }

        return token;
      });
      res.json(result);
    } catch (error: any) {
      console.error(error);
      const isAuthError = error.message?.includes('Unauthorized');
      res.status(isAuthError ? 403 : 500).json({ error: error.message || 'Failed to update token' });
    }
  });

  // Consultations & Prescriptions
  app.get('/api/consultations', authenticateJWT, requireRole(['DOCTOR', 'ADMIN', 'PHARMACY']), async (req, res) => {
    try {
      const { page, limit } = req.query;
      const hasPageOrLimit = page !== undefined || limit !== undefined;

      const includeClause = {
        doctor: true,
        patient: true,
        prescription: {
          include: {
            items: true
          }
        }
      };

      if (hasPageOrLimit) {
        const pageNum = page ? Math.max(1, parseInt(String(page), 10) || 1) : 1;
        const limitNum = limit ? Math.max(1, parseInt(String(limit), 10) || 50) : 50;
        const skip = (pageNum - 1) * limitNum;
        const [total, data] = await Promise.all([
          prisma.consultation.count(),
          prisma.consultation.findMany({
            include: includeClause,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limitNum
          })
        ]);
        return res.json({
          data,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const consultations = await prisma.consultation.findMany({
        include: includeClause,
        orderBy: { createdAt: 'desc' },
        take: 1000 // Safe fallback limit to prevent unbounded heavy loads
      });
      res.json(consultations);
    } catch (error) {
      console.error('Failed to fetch consultations:', error);
      res.status(500).json({ error: 'Failed to fetch consultations' });
    }
  });

  app.post('/api/consultations', authenticateJWT, requireRole(['DOCTOR']), async (req: any, res: any) => {
    const { 
      tokenId, 
      patientId, 
      notes, 
      diagnosis, 
      followUp, 
      medicines, 
      startTime, 
      labTests, 
      referralTargetDocId, 
      referralReason,
      symptoms,
      chiefComplaint,
      vitals,
      allergies,
      observations,
      bpVal,
      tempVal,
      weightVal,
      allergyVal,
      chronicConditionsVal,
      referral
    } = req.body;
    const doctorId = req.user.userId; // Securely derived from the verified JWT.
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Get or Create visit record
        let visit = await tx.visitRecord.findFirst({
          where: { tokenId }
        });
        if (!visit) {
          visit = await tx.visitRecord.create({
            data: { tokenId, patientId, doctorId }
          });
        }

        // Strict boundary: Ensure the doctor submitting the consultation is the one assigned to the visit record.
        if (visit.doctorId !== doctorId) {
          throw new Error('Unauthorized: You are not the assigned doctor for this patient/visit.');
        }

        // Check if consultation already exists
        const existingCons = await tx.consultation.findUnique({
          where: { visitRecordId: visit.id }
        });
        if (existingCons) {
          throw new Error('Consultation already exists for this visit.');
        }

        const isAdviceOnly = !medicines || medicines.length === 0;

        // 2. Create consultation with all custom clinical columns
        const consultation = await tx.consultation.create({
          data: {
            visitRecordId: visit.id,
            patientId,
            doctorId,
            notes,
            diagnosis,
            followUp,
            startTime: startTime ? new Date(startTime) : null,
            endTime: new Date(),
            type: isAdviceOnly ? 'ADVICE_ONLY' : 'WITH_PRESCRIPTION',
            symptoms: symptoms || null,
            chiefComplaint: chiefComplaint || null,
            vitals: vitals || null,
            allergies: allergies || null,
            observations: observations || null,
            chronicConditions: chronicConditionsVal || null,
            referral: referral || null
          }
        });

        // 2.5 Update patient medical card parameters in DB
        const patientUpdateData: any = {};
        if (bpVal) patientUpdateData.bloodPressure = bpVal;
        if (tempVal) patientUpdateData.temperature = tempVal;
        if (weightVal) patientUpdateData.weight = weightVal;
        if (allergyVal) {
          patientUpdateData.medicalHistory = `Allergies: ${allergyVal}`;
          patientUpdateData.allergies = allergyVal;
        }
        if (chronicConditionsVal !== undefined) patientUpdateData.chronicConditions = chronicConditionsVal;

        if (Object.keys(patientUpdateData).length > 0) {
          await tx.patient.update({
            where: { id: patientId },
            data: patientUpdateData
          });
        }

        if (labTests && Array.isArray(labTests) && labTests.length > 0) {
          await tx.labRequest.createMany({
            data: labTests.map((testName: string) => ({
              consultationId: consultation.id,
              patientId,
              doctorId,
              testName
            }))
          });
        }

        if (referralTargetDocId) {
          await tx.referral.create({
            data: {
              consultationId: consultation.id,
              patientId,
              referringDocId: doctorId,
              targetDocId: referralTargetDocId,
              reason: referralReason || 'General reference'
            }
          });
        }

        // 3. Create prescription if medicines exist
        let prescription = null;
        let finalStatus = 'CONSULTATION_COMPLETED';

        if (!isAdviceOnly) {
          // Validate medicine items list against active, non-depleted, and NOT expired batches in database
          for (const m of medicines) {
            const reqQty = parseInt(m.quantity) || 0;
            if (reqQty <= 0) {
              throw new Error(`Quantity must be a valid positive integer for medicine "${m.medicine}".`);
            }

            const activeBatches = await tx.inventoryItem.findMany({
              where: {
                name: { equals: m.medicine, mode: 'insensitive' },
                status: 'ACTIVE',
                OR: [
                  { expiryDate: null },
                  { expiryDate: { gte: new Date() } }
                ]
              }
            });

            const totalAvailable = activeBatches.reduce((acc, b) => acc + (b.stockQuantity || 0), 0);
            if (activeBatches.length === 0) {
              throw new Error(`Item "${m.medicine}" has no active, unexpired stock available in the clinical inventory.`);
            }
            if (totalAvailable < reqQty) {
              throw new Error(`Insufficient available stock. Available: ${totalAvailable}, Requested: ${reqQty} for "${m.medicine}".`);
            }
          }

          prescription = await tx.prescription.create({
            data: {
              consultationId: consultation.id,
              patientId,
              doctorId,
              items: {
                create: medicines.map((m: any) => ({
                  medicine: m.medicine,
                  quantity: parseInt(m.quantity) || 1,
                  dosage: m.dosage || 'As directed',
                  frequency: m.frequency || 'Once daily',
                  duration: m.duration || 'As needed',
                  instructions: m.instructions || '',
                  inventoryItemId: m.inventoryItemId || null
                }))
              }
            },
            include: { items: true }
          });

          // 4. Add to pharmacy queue
          await tx.pharmacyQueue.create({
            data: { prescriptionId: prescription.id }
          });

          finalStatus = 'SENT_TO_PHARMACY';
        } else {
          finalStatus = 'CONSULTATION_COMPLETED_NO_PRESCRIPTION';
        }

        // 5. Update token and doctor queue status
        await tx.token.update({
          where: { id: tokenId },
          data: { status: finalStatus }
        });

        await tx.doctorQueue.update({
          where: { tokenId },
          data: { status: finalStatus }
        });

        // 6. Create Medical History entry
        await tx.medicalHistory.create({
          data: {
            patientId,
            doctorId,
            consultationId: consultation.id,
            notes,
            diagnosis,
            medicines: isAdviceOnly ? null : JSON.stringify(medicines),
            chronicConditions: chronicConditionsVal || null
          }
        });

        return { consultation, prescription, status: finalStatus };
      });

      const docUser = await prisma.user.findUnique({ where: { id: doctorId } });
      await prisma.activityLog.create({
        data: {
          userId: doctorId,
          userName: docUser?.name || 'Staff Physician',
          action: 'CONSULTATION_COMPLETED',
          details: `Consultation completed for patient ID: ${patientId} (Visit: ${result.consultation.visitRecordId})`
        }
      });
      if (result.prescription) {
        await prisma.activityLog.create({
          data: {
            userId: doctorId,
            userName: docUser?.name || 'Staff Physician',
            action: 'PRESCRIPTION_CREATED',
            details: `Prescription issued for patient ID: ${patientId} (Prescription ID: ${result.prescription.id})`
          }
        });
      }

      res.json(result);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to complete consultation' });
    }
  });

  // Patient History (The core fix)
  app.get('/api/patients/:id/history', authenticateJWT, requireRole(['DOCTOR', 'ADMIN', 'PHARMACY', 'RECEPTION']), async (req, res) => {
    try {
      const isDoctor = (req as any).user?.role === 'DOCTOR';
      if (isDoctor) {
        const patientId = req.params.id;
        const doctorId = (req as any).user?.userId;

        const [hasConsultation, hasAppointment, hasToken] = await Promise.all([
          prisma.consultation.findFirst({ where: { patientId, doctorId }, select: { id: true } }),
          prisma.appointment.findFirst({ where: { patientId, doctorId }, select: { id: true } }),
          prisma.token.findFirst({ where: { patientId, doctorId }, select: { id: true } })
        ]);

        if (!hasConsultation && !hasAppointment && !hasToken) {
          return res.status(403).json({ error: 'Forbidden: You are not authorized to access this patient\'s records.' });
        }
      }

      const { page, limit } = req.query;
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : null;

      const whereClause = { patientId: req.params.id };
      const includeClause = {
        doctor: { select: { name: true, department: true } },
        visitRecord: { include: { token: true } },
        prescription: { include: { items: true, pharmacyQueue: { include: { dispensingLog: true } } } },
        labRequests: true,
        referrals: { include: { targetDoc: { select: { name: true, department: true } } } }
      };

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [total, data] = await Promise.all([
          prisma.consultation.count({ where: whereClause }),
          prisma.consultation.findMany({
            where: whereClause,
            include: includeClause,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limitNum
          })
        ]);
        return res.json({
          data,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const history = await prisma.consultation.findMany({
        where: whereClause,
        include: includeClause,
        orderBy: { createdAt: 'desc' }
      });
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  });

  // Token-based prescription retrieval (GET /api/prescription/token/:id & GET /prescription/token/:id)
  const getPrescriptionByToken = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const token = await prisma.token.findFirst({
        where: {
          OR: [
            { id },
            { tokenNumber: id }
          ]
        },
        include: {
          patient: true,
          visitRecord: {
            include: {
              consultation: {
                include: {
                  doctor: { select: { id: true, name: true, email: true, role: true, department: true } },
                  prescription: {
                    include: {
                      items: true,
                      patient: true,
                      doctor: { select: { id: true, name: true, email: true, role: true, department: true } }
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!token) {
        return res.status(404).json({ error: 'Token not found' });
      }

      const prescription = token.visitRecord?.consultation?.prescription;

      if (!prescription) {
        return res.status(404).json({ error: 'No prescription found for the specified token' });
      }

      res.json(prescription);
    } catch (error: any) {
      console.error('Error fetching prescription by token:', error);
      res.status(500).json({ error: 'Failed to retrieve prescription via token lookup' });
    }
  };

  app.get('/api/prescription/token/:id', authenticateJWT, requireRole(['PHARMACY', 'DOCTOR', 'ADMIN']), getPrescriptionByToken);
  app.get('/prescription/token/:id', authenticateJWT, requireRole(['PHARMACY', 'DOCTOR', 'ADMIN']), getPrescriptionByToken);

  // PATCH /api/pharmacy/queue/:id/status
  app.patch('/api/pharmacy/queue/:id/status', authenticateJWT, requireRole(['PHARMACY']), async (req: any, res: any) => {
    try {
      const { status } = req.body;
      const pharmacistId = req.user.userId;

      // 1. Fetch pharmacist user details to store their name and identity
      const pharmacist = await prisma.user.findUnique({
        where: { id: pharmacistId }
      });

      // 2. Load the queue item to find context
      const queueItem = await prisma.pharmacyQueue.findUnique({
        where: { id: req.params.id },
        include: {
          prescription: {
            include: {
              patient: true,
              consultation: { include: { visitRecord: { include: { token: true } } } }
            }
          }
        }
      });

      if (!queueItem) {
        return res.status(404).json({ error: 'Queue item not found' });
      }

      // 3. Update status in database
      const updated = await prisma.pharmacyQueue.update({
        where: { id: req.params.id },
        data: { status }
      });

      const tokenNum = queueItem.prescription.consultation?.visitRecord?.token?.tokenNumber || 'N/A';
      const patName = queueItem.prescription.patient?.name || 'Patient';

      // 4. Create durability and logging of this verification action with the Pharmacist information and timestamp
      await prisma.activityLog.create({
        data: {
          userId: pharmacistId,
          userName: pharmacist?.name || 'Pharmacist Officer',
          action: `Queue Status Updated to ${status}`,
          details: `Prescription for patient ${patName} (Token: #${tokenNum}) verified by pharmacist ${pharmacist?.name || 'Pharmacist'}. Timestamp: ${new Date().toISOString()}`,
          timestamp: new Date()
        }
      });

      res.json(updated);
    } catch (error) {
      console.error('Failed to update pharmacy queue status:', error);
      res.status(500).json({ error: 'Failed to update pharmacy queue status' });
    }
  });

  // Pharmacy Queue
  app.get('/api/pharmacy/queue', authenticateJWT, requireRole(['PHARMACY']), async (req, res) => {
    try {
      const queue = await prisma.pharmacyQueue.findMany({
        where: { status: { in: ['PENDING', 'VERIFIED'] } },
        include: {
          prescription: {
            include: {
              patient: true,
              doctor: { select: { name: true, department: true } },
              consultation: {
                select: {
                  visitRecord: {
                    select: {
                      token: {
                        select: {
                          tokenNumber: true,
                          priority: true
                        }
                      }
                    }
                  }
                }
              },
              items: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      });
      res.json(queue);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch pharmacy queue' });
    }
  });

  app.get('/api/pharmacy/history', authenticateJWT, requireRole(['PHARMACY']), async (req, res) => {
    try {
      const { page, limit, search } = req.query;
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : null;
      const searchStr = search ? String(search).trim() : '';

      const whereClause: any = {};
      if (searchStr) {
        whereClause.pharmacyQueue = {
          prescription: {
            OR: [
              { patient: { name: { contains: searchStr, mode: 'insensitive' } } },
              { patient: { phone: { contains: searchStr } } },
              { doctor: { name: { contains: searchStr, mode: 'insensitive' } } }
            ]
          }
        };
      }

      const includeClause = {
        pharmacyQueue: {
          include: {
            prescription: {
              include: {
                patient: true,
                doctor: { select: { name: true, department: true } },
                consultation: {
                  select: {
                    visitRecord: {
                      select: {
                        token: {
                          select: {
                            tokenNumber: true,
                            priority: true
                          }
                        }
                      }
                    }
                  }
                },
                items: true
              }
            }
          }
        },
        bill: { include: { items: true } }
      };

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [total, data] = await Promise.all([
          prisma.pharmacyDispensingLog.count({ where: whereClause }),
          prisma.pharmacyDispensingLog.findMany({
            where: whereClause,
            include: includeClause,
            orderBy: { dispensedAt: 'desc' },
            skip,
            take: limitNum
          })
        ]);
        return res.json({
          data,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const logs = await prisma.pharmacyDispensingLog.findMany({
        where: whereClause,
        include: includeClause,
        orderBy: { dispensedAt: 'desc' },
        take: 1000
      });
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch pharmacy history' });
    }
  });

  app.post('/api/pharmacy/dispense', authenticateJWT, requireRole(['PHARMACY']), async (req, res) => {
    const { queueId, pharmacistId, items } = req.body; // items: Array<{ name: string, quantity: number, unitPrice: number }>
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Update queue status
        const queueEntry = await tx.pharmacyQueue.update({
          where: { id: queueId },
          data: { status: 'COMPLETED' },
          include: { 
            prescription: { 
              include: { consultation: { include: { visitRecord: { include: { token: true } } } } } 
            } 
          }
        });

        // 2. Create dispensing log
        const log = await tx.pharmacyDispensingLog.create({
          data: {
            pharmacyQueueId: queueId,
            pharmacistId
          }
        });

        // 3. Update prescription status
        await tx.prescription.update({
          where: { id: queueEntry.prescriptionId },
          data: { status: 'DISPENSED' }
        });

        // 4. Create Bill & Decrement Inventory Stocks
        if (items && items.length > 0) {
          const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0);
          const tax = subtotal * 0.05; // 5% tax
          const total = subtotal + tax;

          await tx.bill.create({
            data: {
              patientId: queueEntry.prescription.patientId,
              dispensingLogId: log.id,
              tokenNumber: queueEntry.prescription.consultation.visitRecord.token.tokenNumber,
              subtotal,
              tax,
              total,
              items: {
                create: items.map((i: any) => ({
                  name: i.name,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                  total: i.quantity * i.unitPrice
                }))
              }
            }
          });

          // Stock reduction block removed from dispensing phase.
          // Stock is decremented exactly once upon Billing Payment Completion / Confirmation.
        }

        // 5. Update token and doctor queue status
        const tokenId = queueEntry.prescription.consultation.visitRecord.token.id;
        await tx.token.update({
          where: { id: tokenId },
          data: { status: 'DISPENSED' }
        });
        await tx.doctorQueue.update({
          where: { tokenId },
          data: { status: 'DISPENSED' }
        });

        return queueEntry;
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to dispense and create bill' });
    }
  });

  app.get('/api/pharmacy/dashboard-summary', authenticateJWT, requireRole(['PHARMACY', 'ADMIN', 'DOCTOR']), async (req: any, res: any) => {
    const { startDate, endDate, status, search, patientId } = req.query;
    try {
      const whereClause: any = {};
      if (patientId) {
        whereClause.patientId = String(patientId);
      }
      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) {
          const start = new Date(String(startDate));
          start.setHours(0, 0, 0, 0);
          whereClause.createdAt.gte = start;
        }
        if (endDate) {
          const end = new Date(String(endDate));
          end.setHours(23, 59, 59, 999);
          whereClause.createdAt.lte = end;
        }
      }

      if (status && status !== 'all') {
        if (status === 'completed') {
          whereClause.status = 'PAID';
        } else if (status === 'pending') {
          whereClause.status = 'UNPAID';
        } else if (status === 'flagged') {
          whereClause.status = 'FLAGGED';
        }
      }

      if (search) {
        // If searching by patient or other
        whereClause.OR = [
          { tokenNumber: { contains: search, mode: 'insensitive' } },
          { patient: { name: { contains: search, mode: 'insensitive' } } }
        ];
      }

      // Fetch aggregated data
      // For revenue and comBillsForStats (PAID)
      const comBillsClause = { ...whereClause, status: 'PAID' };
      const paidAgg = await prisma.bill.aggregate({
        where: comBillsClause,
        _sum: { total: true },
        _count: { id: true }
      });
      
      const revenueVal = Number(paidAgg._sum.total || 0);
      const totalDispToday = paidAgg._count.id;

      // Pending clear val (UNPAID or FLAGGED or containing OXYCODONE)
      const pendingClearVal = await prisma.bill.count({
        where: {
          ...whereClause,
          OR: [
            { status: 'UNPAID' },
            { status: 'FLAGGED' },
            { items: { some: { name: { contains: 'OXYCODONE', mode: 'insensitive' } } } }
          ]
        }
      });

      res.json({ revenueVal, totalDispToday, pendingClearVal });
    } catch (error) {
      console.error('Error fetching pharmacy dashboard summary:', error);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  app.get('/api/bills', authenticateJWT, requireRole(['PHARMACY', 'ADMIN', 'DOCTOR', 'RECEPTION']), async (req: any, res: any) => {
    const { startDate, endDate, page, limit, status, search, patientId } = req.query;
    try {
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : null;

      const whereClause: any = {};
      if (patientId) {
        whereClause.patientId = String(patientId);
      }
      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) {
          const start = new Date(String(startDate));
          start.setHours(0, 0, 0, 0);
          whereClause.createdAt.gte = start;
        }
        if (endDate) {
          const end = new Date(String(endDate));
          end.setHours(23, 59, 59, 999);
          whereClause.createdAt.lte = end;
        }
      }

      if (status && status !== 'all') {
        if (status === 'completed') {
          whereClause.status = 'PAID';
        } else if (status === 'pending') {
          whereClause.status = 'UNPAID';
        } else if (status === 'flagged') {
          whereClause.status = 'FLAGGED';
        }
      }

      if (search && String(search).trim()) {
        const s = String(search).trim();
        whereClause.AND = [
          {
            OR: [
              { id: { contains: s, mode: 'insensitive' } },
              { tokenNumber: { contains: s, mode: 'insensitive' } },
              { patientId: { contains: s, mode: 'insensitive' } },
              {
                patient: {
                  name: { contains: s, mode: 'insensitive' }
                }
              },
              {
                items: {
                  some: {
                    name: { contains: s, mode: 'insensitive' }
                  }
                }
              }
            ]
          }
        ];
      }

      const includeClause = {
        patient: {
          select: {
            id: true,
            name: true
          }
        },
        items: {
          select: {
            id: true,
            billId: true,
            name: true,
            quantity: true,
            unitPrice: true,
            total: true
          }
        },
        dispensingLog: {
          select: {
            id: true,
            pharmacyQueueId: true,
            dispensedAt: true,
            pharmacistId: true,
            pharmacyQueue: {
              select: {
                id: true,
                prescriptionId: true,
                status: true,
                createdAt: true,
                prescription: {
                  select: {
                    id: true,
                    patientId: true,
                    doctorId: true,
                    consultationId: true,
                    status: true,
                    createdAt: true,
                    doctor: {
                      select: {
                        name: true,
                        department: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [total, data] = await Promise.all([
          prisma.bill.count({ where: whereClause }),
          prisma.bill.findMany({
            where: whereClause,
            include: includeClause,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limitNum
          })
        ]);
        return res.json({
          data,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      }

      const bills = await prisma.bill.findMany({
        where: whereClause,
        include: includeClause,
        orderBy: { createdAt: 'desc' },
        take: 1000
      });
      res.json(bills);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch bills' });
    }
  });

  app.get('/api/export/bills', authenticateJWT, requireRole(['PHARMACY', 'ADMIN', 'DOCTOR', 'RECEPTION']), async (req: any, res: any) => {
    try {
      const includeClause = {
        patient: {
          select: {
            id: true,
            name: true
          }
        },
        items: {
          select: {
            id: true,
            billId: true,
            name: true,
            quantity: true,
            unitPrice: true,
            total: true
          }
        },
        dispensingLog: {
          select: {
            id: true,
            pharmacyQueueId: true,
            dispensedAt: true,
            pharmacistId: true,
            pharmacyQueue: {
              select: {
                id: true,
                prescriptionId: true,
                status: true,
                createdAt: true,
                prescription: {
                  select: {
                    id: true,
                    patientId: true,
                    doctorId: true,
                    consultationId: true,
                    status: true,
                    createdAt: true,
                    doctor: {
                      select: {
                        name: true,
                        department: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.write('[');

      let skip = 0;
      const batchSize = 1000;
      let hasMore = true;
      let isFirst = true;

      while (hasMore) {
        const batch = await prisma.bill.findMany({
          include: includeClause,
          orderBy: { createdAt: 'desc' },
          skip: skip,
          take: batchSize
        });

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        for (const item of batch) {
          if (!isFirst) {
            res.write(',');
          } else {
            isFirst = false;
          }
          res.write(JSON.stringify(item));
        }

        skip += batch.length;
        if (batch.length < batchSize) {
          hasMore = false;
        }

        await new Promise((resolve) => setImmediate(resolve));
      }

      res.write(']');
      res.end();
    } catch (error) {
      console.error('Failed to export bills:', error);
      if (res.headersSent) {
        res.end();
      } else {
        res.status(500).json({ error: 'Failed to export bills' });
      }
    }
  });

  app.patch('/api/bills/:id/status', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    const { status } = req.body;
    const billId = req.params.id;
    const username = req.user?.name || req.headers['x-user-name'] || 'Pharmacist';

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Implement row-level lock on the Bill record before status evaluation
        await tx.$executeRaw`SELECT 1 FROM "Bill" WHERE id = ${billId} FOR UPDATE`;

        // 1. Fetch current bill with its items
        const currentBill = await tx.bill.findUnique({
          where: { id: billId },
          include: { items: true }
        });

        if (!currentBill) {
          throw new Error('Invoice / Bill record not found.');
        }

        // Only deduct stock if status is transitioning to PAID/Completed and was not already PAID
        if (status === 'PAID' && currentBill.status !== 'PAID') {
          // 1. Gather all unique non-empty item names to fetch in bulk
          const itemNames = Array.from(new Set(
            currentBill.items
              .map(item => item.name)
              .filter(name => name && name.trim() !== '')
          ));

          if (itemNames.length > 0) {
            // 2. Fetch all active, non-expired batches for these medicines in bulk
            const allActiveBatches = await tx.inventoryItem.findMany({
              where: {
                name: { in: itemNames, mode: 'insensitive' },
                status: 'ACTIVE',
                OR: [
                  { expiryDate: null },
                  { expiryDate: { gte: new Date() } }
                ]
              },
              orderBy: [
                { expiryDate: 'asc' }, // FEFO: nearest expiry first!
                { createdAt: 'asc' }
              ]
            });

            if (allActiveBatches.length > 0) {
              // Lock the inventory rows in Postgres to prevent concurrent updates on the same batches.
              // We sort the IDs consistently to guarantee deadlock-free execution in all concurrent threads.
              const sortedIds = allActiveBatches.map(b => b.id).sort();
              const idsParam = sortedIds.map(id => `'${id}'`).join(', ');
              await tx.$executeRawUnsafe(`SELECT 1 FROM "InventoryItem" WHERE id IN (${idsParam}) FOR UPDATE`);

              // Reload the locked batches immediately to secure the absolute latest database-level stock quantities in memory
              const freshActiveBatches = await tx.inventoryItem.findMany({
                where: {
                  id: { in: sortedIds }
                },
                orderBy: [
                  { expiryDate: 'asc' },
                  { createdAt: 'asc' }
                ]
              });

              allActiveBatches.length = 0;
              allActiveBatches.push(...freshActiveBatches);
            }

            // Build an in-memory lookup map of lowercase item name -> active batches
            const batchesByName = new Map<string, typeof allActiveBatches>();
            for (const batch of allActiveBatches) {
              const lowerName = batch.name.toLowerCase();
              if (!batchesByName.has(lowerName)) {
                batchesByName.set(lowerName, []);
              }
              batchesByName.get(lowerName)!.push(batch);
            }

            // Loop through each item in the bill to allocate and deduct
            for (const item of currentBill.items) {
              let requiredQuantity = parseInt(String(item.quantity)) || 0;
              if (requiredQuantity <= 0) continue;

              const activeBatches = batchesByName.get(item.name.toLowerCase()) || [];

              // Calculate total stock across active non-expired batches
              const totalAvailable = activeBatches.reduce((acc, batch) => acc + batch.stockQuantity, 0);
              if (totalAvailable < requiredQuantity) {
                throw new Error(`Insufficient Stock: Only ${totalAvailable} available in active batches for "${item.name}" (Requested: ${requiredQuantity}).`);
              }

              // Deduct stock sequentially (FEFO)
              let remainingToDeduct = requiredQuantity;
              for (const batch of activeBatches) {
                if (remainingToDeduct <= 0) break;

                const availableInBatch = batch.stockQuantity;
                if (availableInBatch <= 0) continue;

                const deductFromThisBatch = Math.min(availableInBatch, remainingToDeduct);
                const newQty = availableInBatch - deductFromThisBatch;

                // Update in-memory quantities
                batch.stockQuantity = newQty;

                // Update batch stock in database and auto-deplete if zero
                await tx.inventoryItem.update({
                  where: { id: batch.id },
                  data: { 
                    stockQuantity: newQty,
                    status: newQty <= 0 ? 'DEPLETED' : batch.status
                  }
                });

                // Create InventoryTransaction of type DISPENSED
                await tx.inventoryTransaction.create({
                  data: {
                    inventoryItemId: batch.id,
                    type: 'DISPENSED',
                    quantity: deductFromThisBatch,
                    performedBy: username,
                    referenceId: billId
                  }
                });

                remainingToDeduct -= deductFromThisBatch;
              }
            }
          }
        }

        // 5. Update Bill status
        const updatedBill = await tx.bill.update({
          where: { id: billId },
          data: { status }
        });

        return updatedBill;
      });

      res.json(result);
    } catch (error: any) {
      console.error(error);
      res.status(400).json({ error: error.message || 'Failed to update bill status' });
    }
  });

  // --- INVENTORY API ENDPOINTS ---

  // GET /api/inventory
  app.get('/api/inventory', authenticateJWT, requireRole(['PHARMACY', 'ADMIN', 'DOCTOR']), async (req, res) => {
    try {
      const { page, limit, search } = req.query;
      const pageNum = page ? parseInt(String(page), 10) : null;
      const limitNum = limit ? parseInt(String(limit), 10) : 50; // target limit = 50
      const searchStr = search ? String(search).trim() : '';

      const whereClause: any = {
        NOT: { status: 'DELETED' }
      };

      if (searchStr) {
        whereClause.OR = [
          { name: { contains: searchStr, mode: 'insensitive' } },
          { genericName: { contains: searchStr, mode: 'insensitive' } },
          { brandName: { contains: searchStr, mode: 'insensitive' } },
          { itemCode: { contains: searchStr, mode: 'insensitive' } }
        ];
      }

      let total = 0;
      let items: any[] = [];

      if (pageNum && limitNum) {
        const skip = (pageNum - 1) * limitNum;
        const [countVal, fetchedItems] = await Promise.all([
          prisma.inventoryItem.count({ where: whereClause }),
          prisma.inventoryItem.findMany({
            where: whereClause,
            include: { supplier: true },
            orderBy: { name: 'asc' },
            skip,
            take: limitNum
          })
        ]);
        total = countVal;
        items = fetchedItems;
      } else {
        items = await prisma.inventoryItem.findMany({
          where: whereClause,
          include: { supplier: true },
          orderBy: { name: 'asc' },
          take: 50 // safe default bounded size to protect from unbounded payloads
        });
      }

      const itemNames = Array.from(new Set(items.map((item: any) => item.name).filter(Boolean)));
      const now = new Date();

      const [activeNonExpiredGroup, expiredGroup] = itemNames.length > 0 ? await Promise.all([
        prisma.inventoryItem.groupBy({
          by: ['name'],
          where: {
            name: { in: itemNames },
            status: 'ACTIVE',
            stockQuantity: { gt: 0 },
            OR: [
              { expiryDate: null },
              { expiryDate: { gte: now } }
            ]
          },
          _sum: {
            stockQuantity: true
          },
          _count: {
            id: true
          },
          _min: {
            expiryDate: true
          }
        }),
        prisma.inventoryItem.groupBy({
          by: ['name'],
          where: {
            name: { in: itemNames },
            status: 'ACTIVE',
            stockQuantity: { gt: 0 },
            expiryDate: { lt: now }
          },
          _count: {
            id: true
          }
        })
      ]) : [[], []];

      const totalStockMap = new Map<string, number>();
      const activeBatchCountMap = new Map<string, number>();
      const nextExpiryDatesMap = new Map<string, Date>();
      const hasExpiredMap = new Map<string, boolean>();

      activeNonExpiredGroup.forEach((g: any) => {
        if (!g.name) return;
        const key = g.name.toLowerCase();
        totalStockMap.set(key, g._sum.stockQuantity || 0);
        activeBatchCountMap.set(key, g._count.id || 0);
        if (g._min.expiryDate) {
          nextExpiryDatesMap.set(key, g._min.expiryDate);
        }
      });

      expiredGroup.forEach((g: any) => {
        if (!g.name) return;
        const key = g.name.toLowerCase();
        const count = g._count.id || 0;
        if (count > 0) {
          hasExpiredMap.set(key, true);
        }
      });

      const enhancedItems = items.map((item) => {
        const key = (item.name || '').toLowerCase();
        const totalStock = totalStockMap.get(key) || 0;
        const activeBatchCount = activeBatchCountMap.get(key) || 0;
        const nextExpiryDate = nextExpiryDatesMap.get(key) || null;
        const isLowStock = totalStock <= (item.minThreshold || 10);
        const hasExpiredBatches = hasExpiredMap.get(key) || false;

        return {
          ...item,
          totalStock,
          activeBatchCount,
          nextExpiryDate,
          isLowStock,
          hasExpiredBatches
        };
      });

      if (pageNum && limitNum) {
        res.json({
          data: enhancedItems,
          page: pageNum,
          limit: limitNum,
          total,
          hasNextPage: total > pageNum * limitNum
        });
      } else {
        res.json(enhancedItems);
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to fetch inventory items' });
    }
  });

  // GET /api/inventory/search
  app.get('/api/inventory/search', authenticateJWT, requireRole(['PHARMACY', 'ADMIN', 'DOCTOR']), async (req, res) => {
    const q = req.query.q ? String(req.query.q) : '';
    try {
      const items = await prisma.inventoryItem.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { genericName: { contains: q, mode: 'insensitive' } },
            { brandName: { contains: q, mode: 'insensitive' } },
            { itemCode: { contains: q, mode: 'insensitive' } }
          ],
          status: 'ACTIVE'
        },
        include: { supplier: true },
        take: 50
      });
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: 'Failed to search inventory' });
    }
  });

  // GET /api/inventory/low-stock
  app.get('/api/inventory/low-stock', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const allItems = await prisma.inventoryItem.findMany({
        where: {
          NOT: { status: 'DELETED' }
        },
        include: { supplier: true }
      });
      const lowStockItems = allItems.filter(item => item.stockQuantity <= item.minThreshold);
      res.json(lowStockItems);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
  });

  // GET /api/inventory/expired
  app.get('/api/inventory/expired', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const expiredItems = await prisma.inventoryItem.findMany({
        where: {
          expiryDate: { lt: new Date() },
          NOT: { status: 'DELETED' }
        },
        include: { supplier: true }
      });
      res.json(expiredItems);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch expired items' });
    }
  });

  // POST /api/inventory
  app.post('/api/inventory', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const { 
        itemCode, name, genericName, brandName, category, type, dosage, unit, 
        batchNumber, expiryDate, supplierId, purchasePrice, sellingPrice, price,
        stockQuantity, minThreshold, maxThreshold, reorderLevel, status,
        shelfLocation
      } = req.body;

      const user = req.headers['x-user-name'] || 'System';

      let cleanItemCode = itemCode ? String(itemCode).trim() : '';
      if (!cleanItemCode) {
        const cleanName = String(name || 'DRUG').toUpperCase().replace(/[^A-Z0-9]/g, '');
        cleanItemCode = `MED-${cleanName.slice(0, 8)}-${Date.now().toString().slice(-4)}`;
      }

      const existing = await prisma.inventoryItem.findUnique({
        where: { itemCode: cleanItemCode }
      });
      if (existing) {
        return res.status(400).json({ error: `An item with itemCode ${cleanItemCode} already exists.` });
      }

      const cleanShelfLocation = shelfLocation ? String(shelfLocation).trim() : '';
      if (cleanShelfLocation.length > 50) {
        return res.status(400).json({ error: 'Shelf Location cannot exceed 50 characters.' });
      }

      // Prevent duplicate medicine records having identical Medicine Name + Dosage Form + Shelf Location
      const trimmedName = String(name || '').trim();
      const trimmedDosage = String(dosage || '').trim();

      const dup = await prisma.inventoryItem.findFirst({
        where: {
          name: { equals: trimmedName, mode: 'insensitive' },
          dosage: { equals: trimmedDosage, mode: 'insensitive' },
          shelfLocation: { equals: cleanShelfLocation, mode: 'insensitive' }
        }
      });
      if (dup) {
        return res.status(400).json({ error: `A medicine record with identical name '${trimmedName}', dosage form '${trimmedDosage}', and shelf location '${cleanShelfLocation || "N/A"}' already exists.` });
      }

      const parsedPurchase = parseFloat(purchasePrice !== undefined ? purchasePrice : (price !== undefined ? Number(price) * 0.75 : 0));
      const parsedSelling = parseFloat(sellingPrice !== undefined ? sellingPrice : (price !== undefined ? price : 0));
      const parsedStock = parseInt(stockQuantity !== undefined ? stockQuantity : 0);
      const parsedMin = parseInt(minThreshold !== undefined ? minThreshold : 10);
      const parsedMax = parseInt(maxThreshold !== undefined ? maxThreshold : 100);
      const parsedReorder = parseInt(reorderLevel !== undefined ? reorderLevel : 20);

      const safePurchasePrice = isNaN(parsedPurchase) ? 0 : parsedPurchase;
      const safeSellingPrice = isNaN(parsedSelling) ? 0 : parsedSelling;
      const safeStockQuantity = isNaN(parsedStock) ? 0 : parsedStock;
      const safeMinThreshold = isNaN(parsedMin) ? 10 : parsedMin;
      const safeMaxThreshold = isNaN(parsedMax) ? 100 : parsedMax;
      const safeReorderLevel = isNaN(parsedReorder) ? 20 : parsedReorder;

      const item = await prisma.inventoryItem.create({
        data: {
          itemCode: cleanItemCode,
          name,
          genericName: genericName || '',
          brandName: brandName || '',
          category: category || 'General',
          type: type || 'MEDICINE',
          dosage: dosage || '',
          unit: unit || 'Box',
          batchNumber: batchNumber || `BCH-${Math.floor(1000 + Math.random() * 9000)}`,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          supplierId: supplierId || null,
          purchasePrice: safePurchasePrice,
          sellingPrice: safeSellingPrice,
          stockQuantity: safeStockQuantity,
          minThreshold: safeMinThreshold,
          maxThreshold: safeMaxThreshold,
          reorderLevel: safeReorderLevel,
          status: status || 'ACTIVE',
          shelfLocation: cleanShelfLocation
        },
        include: { supplier: true }
      });

      // Log STOCK_IN transaction initially if quantity > 0
      if (safeStockQuantity > 0) {
        await prisma.inventoryTransaction.create({
          data: {
            inventoryItemId: item.id,
            type: 'STOCK_IN',
            quantity: safeStockQuantity,
            performedBy: String(user),
            referenceId: 'INITIAL_STOCK'
          }
        });
      }

      res.json(item);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to create inventory item' });
    }
  });

  // POST /api/inventory/add-stock
  app.post('/api/inventory/add-stock', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    const { parentItemId, batchNumber, stockQuantity, expiryDate, supplierId } = req.body;
    try {
      const parentItem = await prisma.inventoryItem.findUnique({
        where: { id: parentItemId }
      });

      if (!parentItem) {
        return res.status(404).json({ error: 'Medicine not found in inventory.' });
      }

      // Generate a unique item code for this batch
      const cleanBatch = String(batchNumber || 'NEW').replace(/[^a-zA-Z0-9]/g, '');
      const itemCode = `${parentItem.itemCode}_${cleanBatch}_${Date.now().toString().slice(-4)}`;

      // Use a single database transaction to guarantee atomicity of batch creation and transaction logging
      const newBatch = await prisma.$transaction(async (tx) => {
        // Create new InventoryItem with the new batch attributes
        const batch = await tx.inventoryItem.create({
          data: {
            itemCode,
            name: parentItem.name,
            genericName: parentItem.genericName,
            brandName: parentItem.brandName,
            category: parentItem.category || 'TABLET',
            type: parentItem.type || 'MEDICINE',
            dosage: parentItem.dosage || '10mg',
            unit: parentItem.unit || 'Box',
            batchNumber: batchNumber || `BCH-${Math.floor(1000 + Math.random() * 9000)}`,
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            supplierId: supplierId || parentItem.supplierId,
            purchasePrice: parentItem.purchasePrice || 0,
            sellingPrice: parentItem.sellingPrice || 15.0,
            stockQuantity: parseInt(stockQuantity) || 0,
            minThreshold: parentItem.minThreshold || 20,
            maxThreshold: parentItem.maxThreshold || 100,
            reorderLevel: parentItem.reorderLevel || 20,
            status: 'ACTIVE'
          }
        });

        // Write inventory transaction for stock-in
        await tx.inventoryTransaction.create({
          data: {
            inventoryItemId: batch.id,
            type: 'STOCK_IN',
            quantity: parseInt(stockQuantity) || 0,
            performedBy: req.headers['x-user-name'] || req.user?.name || 'System',
            referenceId: 'BATCH_ADD'
          }
        });

        return batch;
      });

      res.status(201).json(newBatch);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to add stock batch.' });
    }
  });

  // PATCH /api/inventory/:id
  app.patch('/api/inventory/:id', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const { 
        itemCode, name, genericName, brandName, category, type, dosage, unit, 
        batchNumber, expiryDate, supplierId, purchasePrice, sellingPrice, 
        stockQuantity, minThreshold, maxThreshold, reorderLevel, status, adjustQty, adjustType,
        shelfLocation
      } = req.body;

      const user = req.headers['x-user-name'] || 'System';

      const existingItem = await prisma.inventoryItem.findUnique({
        where: { id: req.params.id }
      });

      if (!existingItem) {
        return res.status(404).json({ error: 'Inventory item not found' });
      }

      let cleanShelfLocation = shelfLocation !== undefined ? String(shelfLocation).trim() : undefined;
      if (cleanShelfLocation !== undefined && cleanShelfLocation.length > 50) {
        return res.status(400).json({ error: 'Shelf Location cannot exceed 50 characters.' });
      }

      // Prevent duplicate medicine records having identical Medicine Name + Dosage Form + Shelf Location
      const targetName = name !== undefined ? String(name).trim() : existingItem.name;
      const targetDosage = dosage !== undefined ? String(dosage).trim() : existingItem.dosage;
      const targetShelf = cleanShelfLocation !== undefined ? cleanShelfLocation : existingItem.shelfLocation;

      if (name !== undefined || dosage !== undefined || shelfLocation !== undefined) {
        const dup = await prisma.inventoryItem.findFirst({
          where: {
            id: { not: req.params.id },
            name: { equals: targetName, mode: 'insensitive' },
            dosage: { equals: targetDosage || '', mode: 'insensitive' },
            shelfLocation: { equals: targetShelf || '', mode: 'insensitive' }
          }
        });
        if (dup) {
          return res.status(400).json({ error: `Cannot update: another medicine with identical name '${targetName}', dosage form '${targetDosage || "N/A"}', and shelf location '${targetShelf || "N/A"}' already exists.` });
        }
      }

      let updatedQty = existingItem.stockQuantity;
      if (typeof stockQuantity !== 'undefined') {
        const parsedStock = parseInt(String(stockQuantity));
        updatedQty = isNaN(parsedStock) ? existingItem.stockQuantity : parsedStock;
      } else if (adjustQty) {
        const qtyToAdjust = parseInt(String(adjustQty));
        if (!isNaN(qtyToAdjust)) {
          if (adjustType === 'ADD' || adjustType === 'STOCK_IN') {
            updatedQty += qtyToAdjust;
          } else if (adjustType === 'SUB') {
            updatedQty = Math.max(0, updatedQty - qtyToAdjust);
          }
        }
      }

      let resolvedStatus = status;
      if (typeof resolvedStatus === 'undefined' || resolvedStatus === 'ACTIVE' || resolvedStatus === 'DEPLETED') {
        resolvedStatus = updatedQty <= 0 ? 'DEPLETED' : 'ACTIVE';
      }

      const parsedPurchase = purchasePrice !== undefined ? parseFloat(String(purchasePrice)) : undefined;
      const parsedSelling = sellingPrice !== undefined ? parseFloat(String(sellingPrice)) : undefined;
      const parsedMin = minThreshold !== undefined ? parseInt(String(minThreshold)) : undefined;
      const parsedMax = maxThreshold !== undefined ? parseInt(String(maxThreshold)) : undefined;
      const parsedReorder = reorderLevel !== undefined ? parseInt(String(reorderLevel)) : undefined;

      const safePurchasePrice = parsedPurchase !== undefined && !isNaN(parsedPurchase) ? parsedPurchase : undefined;
      const safeSellingPrice = parsedSelling !== undefined && !isNaN(parsedSelling) ? parsedSelling : undefined;
      const safeMinThreshold = parsedMin !== undefined && !isNaN(parsedMin) ? parsedMin : undefined;
      const safeMaxThreshold = parsedMax !== undefined && !isNaN(parsedMax) ? parsedMax : undefined;
      const safeReorderLevel = parsedReorder !== undefined && !isNaN(parsedReorder) ? parsedReorder : undefined;

      const item = await prisma.inventoryItem.update({
        where: { id: req.params.id },
        data: {
          itemCode,
          name,
          genericName,
          brandName,
          category,
          type,
          dosage,
          unit,
          batchNumber,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          supplierId: supplierId || null,
          purchasePrice: safePurchasePrice,
          sellingPrice: safeSellingPrice,
          stockQuantity: updatedQty,
          minThreshold: safeMinThreshold,
          maxThreshold: safeMaxThreshold,
          reorderLevel: safeReorderLevel,
          status: resolvedStatus,
          shelfLocation: cleanShelfLocation !== undefined ? cleanShelfLocation : undefined
        },
        include: { supplier: true }
      });

      // Create transaction if the stock quantity actually changed
      const qtyDiff = updatedQty - existingItem.stockQuantity;
      if (qtyDiff !== 0) {
        await prisma.inventoryTransaction.create({
          data: {
            inventoryItemId: item.id,
            type: qtyDiff > 0 ? 'STOCK_IN' : 'ADJUSTMENT',
            quantity: Math.abs(qtyDiff),
            performedBy: String(user),
            referenceId: adjustType || 'MANUAL_UPDATE'
          }
        });
      }

      res.json(item);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to update inventory item' });
    }
  });

  // DELETE /api/inventory/:id
  app.delete('/api/inventory/:id', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const id = req.params.id;
      const item = await prisma.inventoryItem.findUnique({
        where: { id }
      });

      if (!item) {
        return res.status(404).json({ error: 'Inventory batch not found.' });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const batchExp = item.expiryDate ? new Date(item.expiryDate) : null;
      if (batchExp) {
        batchExp.setHours(0, 0, 0, 0);
      }
      const isExpired = batchExp && batchExp < today;
      const isEmpty = (item.stockQuantity || 0) === 0;

      // Rule 1: Allow manual deletion ONLY for Expired batches or Empty (Qty = 0) batches
      if (!isExpired && !isEmpty) {
        return res.status(400).json({ error: 'Deletion is permitted only for expired or depleted (qty = 0) batches. This batch contains active stock.' });
      }

      // Rule 2: Prevent deletion if batch still contains active inventory
      if (item.status === 'ACTIVE' && (item.stockQuantity || 0) > 0 && !isExpired) {
        return res.status(400).json({ error: 'Cannot delete a batch that still contains active, non-expired inventory.' });
      }

      // Rule 3: Prevent deletion if batch is currently used by active pharmacy transactions
      const pendingBillsWithMed = await prisma.billItem.findFirst({
        where: {
          name: { equals: item.name, mode: 'insensitive' },
          bill: {
            status: 'UNPAID'
          }
        }
      });

      if (pendingBillsWithMed) {
        return res.status(400).json({ error: `Cannot delete this batch because the medicine "${item.name}" is currently referenced by pending unpaid bills.` });
      }

      // Check if this specific batch is linked to any pending queue prescriptions
      const activePrescription = await prisma.prescriptionItem.findFirst({
        where: {
          inventoryItemId: id,
          prescription: {
            pharmacyQueue: {
              status: 'PENDING'
            }
          }
        }
      });

      if (activePrescription) {
        return res.status(400).json({ error: 'Cannot delete this batch because it is currently linked to a prescription in the pending pharmacy queue.' });
      }

      // Soft delete: update status to 'DELETED' to keep all audit/transaction records intact!
      await prisma.inventoryItem.update({
        where: { id },
        data: { status: 'DELETED' }
      });

      res.json({ success: true, message: 'Batch removed successfully from active inventory.' });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: 'Failed to delete inventory item: ' + error.message });
    }
  });

  // GET /api/suppliers
  app.get('/api/suppliers', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const cacheKey = 'suppliers';
      const cached = getCachedData(cacheKey);
      if (cached) return res.json(cached);

      const suppliers = await prisma.supplier.findMany({
        orderBy: { name: 'asc' }
      });
      setCachedData(cacheKey, suppliers, 15 * 60 * 1000); // 15 minutes cache
      res.json(suppliers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
  });

  // POST /api/suppliers
  app.post('/api/suppliers', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const supplier = await prisma.supplier.create({
        data: req.body
      });
      invalidateCachedData('suppliers');
      res.json(supplier);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create supplier' });
    }
  });

  // GET /api/inventory/transactions
  app.get('/api/inventory/transactions', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const transactions = await prisma.inventoryTransaction.findMany({
        include: { inventoryItem: true },
        orderBy: { timestamp: 'desc' },
        take: 100
      });
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch inventory transactions' });
    }
  });

  // POST /api/inventory/reorder
  app.post('/api/inventory/reorder', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const { inventoryItemId, quantityRequested, requestedBy, notes, expectedDelivery } = req.body;
      const reorder = await prisma.reorderRequest.create({
        data: {
          inventoryItemId,
          quantityRequested: parseInt(quantityRequested),
          requestedBy: requestedBy || 'Admin Manager',
          notes,
          expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null
        },
        include: { inventoryItem: true }
      });
      res.json(reorder);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to create reorder request' });
    }
  });

  // GET /api/inventory/reorders
  app.get('/api/inventory/reorders', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const reorders = await prisma.reorderRequest.findMany({
        include: { inventoryItem: true },
        orderBy: { createdAt: 'desc' }
      });
      res.json(reorders);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch reorders' });
    }
  });

  // PATCH /api/inventory/reorders/:id
  app.patch('/api/inventory/reorders/:id', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const { status } = req.body;
      const reorder = await prisma.reorderRequest.update({
        where: { id: req.params.id },
        data: { status },
        include: { inventoryItem: true }
      });

      // If reorder request is marked COMPLETED, let's automatically credit the stock
      if (status === 'COMPLETED') {
        const existingItem = await prisma.inventoryItem.findUnique({
          where: { id: reorder.inventoryItemId }
        });
        if (existingItem) {
          const newQty = existingItem.stockQuantity + reorder.quantityRequested;
          const isStillDepleted = newQty <= 0;
          const item = await prisma.inventoryItem.update({
            where: { id: reorder.inventoryItemId },
            data: {
              stockQuantity: newQty,
              status: isStillDepleted ? 'DEPLETED' : (existingItem.status === 'DEPLETED' ? 'ACTIVE' : existingItem.status)
            }
          });

          // and add a stocking transaction
          await prisma.inventoryTransaction.create({
            data: {
              inventoryItemId: item.id,
              type: 'STOCK_IN',
              quantity: reorder.quantityRequested,
              performedBy: 'System Auto-Credit',
              referenceId: `REORDER_${reorder.id}`
            }
          });
        }
      }

      res.json(reorder);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to update reorder request' });
    }
  });

  // POST /api/inventory/bulk-import
  app.post('/api/inventory/bulk-import', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Items payload must be an array' });
      }

      const imported = [];
      const user = req.headers['x-user-name'] || 'Bulk File System';

      // Prefetch all requested itemCodes to prevent N+1 query overhead in loop
      const requestedItemCodes = items.map((i: any) => i.itemCode).filter((code): code is string => typeof code === 'string' && !!code.trim());
      const existingItems = await prisma.inventoryItem.findMany({
        where: { itemCode: { in: requestedItemCodes } }
      });
      const existingItemsMap = new Map(existingItems.map(item => [item.itemCode, item]));

      for (const raw of items) {
        if (!raw.itemCode || !raw.name) continue;
        
        // Find existing from pre-fetched map
        const existing = existingItemsMap.get(raw.itemCode);

        if (existing) {
          const updated = await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              name: raw.name || existing.name,
              genericName: raw.genericName || existing.genericName,
              brandName: raw.brandName || existing.brandName,
              category: raw.category || existing.category,
              type: raw.type || existing.type || 'MEDICINE',
              dosage: raw.dosage || existing.dosage,
              unit: raw.unit || existing.unit,
              batchNumber: raw.batchNumber || existing.batchNumber,
              expiryDate: raw.expiryDate ? new Date(raw.expiryDate) : existing.expiryDate,
              purchasePrice: raw.purchasePrice ? parseFloat(raw.purchasePrice) : existing.purchasePrice,
              sellingPrice: raw.sellingPrice ? parseFloat(raw.sellingPrice) : existing.sellingPrice,
              stockQuantity: raw.stockQuantity ? parseInt(raw.stockQuantity) : existing.stockQuantity,
              minThreshold: raw.minThreshold ? parseInt(raw.minThreshold) : existing.minThreshold,
              maxThreshold: raw.maxThreshold ? parseInt(raw.maxThreshold) : existing.maxThreshold,
              reorderLevel: raw.reorderLevel ? parseInt(raw.reorderLevel) : existing.reorderLevel,
              status: raw.status || existing.status
            }
          });
          imported.push(updated);
        } else {
          const created = await prisma.inventoryItem.create({
            data: {
              itemCode: raw.itemCode,
              name: raw.name,
              genericName: raw.genericName || '',
              brandName: raw.brandName || '',
              category: raw.category || 'General',
              type: raw.type || 'MEDICINE',
              dosage: raw.dosage || '',
              unit: raw.unit || 'Box',
              batchNumber: raw.batchNumber || `BCH-${Math.floor(1000 + Math.random() * 9000)}`,
              expiryDate: raw.expiryDate ? new Date(raw.expiryDate) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year
              purchasePrice: parseFloat(raw.purchasePrice) || 0,
              sellingPrice: parseFloat(raw.sellingPrice) || 0,
              stockQuantity: parseInt(raw.stockQuantity) || 0,
              minThreshold: parseInt(raw.minThreshold) || 10,
              maxThreshold: parseInt(raw.maxThreshold) || 100,
              reorderLevel: parseInt(raw.reorderLevel) || 20,
              status: raw.status || 'ACTIVE'
            }
          });
          
          if (created.stockQuantity > 0) {
            await prisma.inventoryTransaction.create({
              data: {
                inventoryItemId: created.id,
                type: 'STOCK_IN',
                quantity: created.stockQuantity,
                performedBy: String(user),
                referenceId: 'BULK_IMPORT'
              }
            });
          }
          imported.push(created);
        }
      }
      res.json({ success: true, count: imported.length });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed bulk importing items' });
    }
  });


  // POST /api/inventory/bulk-upload
  app.post('/api/inventory/bulk-upload', authenticateJWT, requireRole(['PHARMACY', 'ADMIN']), async (req: any, res: any) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Items payload must be an array' });
      }

      const user = req.headers['x-user-name'] || 'Bulk File System';

      let createdCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      // Keep track of batch numbers seen in this upload payload to avoid duplicates within the file
      const seenInUpload = new Set<string>();

      for (let index = 0; index < items.length; index++) {
        const raw = items[index];
        const rowNum = index + 1;

        // 1. Validate inputs
        const name = raw.name ? String(raw.name).trim() : '';
        const quantity = raw.stockQuantity !== undefined ? Number(raw.stockQuantity) : NaN;
        const expiryDateStr = raw.expiryDate ? String(raw.expiryDate).trim() : '';
        const price = raw.price !== undefined ? Number(raw.price) : NaN;

        if (!name) {
          failedCount++;
          errors.push(`Row ${rowNum}: Missing Medicine Name`);
          continue;
        }

        if (isNaN(quantity)) {
          failedCount++;
          errors.push(`Row ${rowNum} (${name || 'Unnamed'}): Missing Quantity`);
          continue;
        }

        if (quantity < 0) {
          failedCount++;
          errors.push(`Row ${rowNum} (${name}): Negative Quantity is forbidden`);
          continue;
        }

        if (!expiryDateStr) {
          failedCount++;
          errors.push(`Row ${rowNum} (${name}): Missing Expiry Date`);
          continue;
        }

        const parsedExpiry = new Date(expiryDateStr);
        if (isNaN(parsedExpiry.getTime())) {
          failedCount++;
          errors.push(`Row ${rowNum} (${name}): Invalid Expiry Date format`);
          continue;
        }

        if (isNaN(price) || price <= 0) {
          failedCount++;
          errors.push(`Row ${rowNum} (${name}): Invalid Price (must be greater than 0)`);
          continue;
        }

        const batchNumber = raw.batchNumber ? String(raw.batchNumber).trim() : `BCH-${Math.floor(1000 + Math.random() * 9000)}`;

        // Check duplicates within the uploaded file
        const uploadKey = `${name.toLowerCase()}__${batchNumber.toLowerCase()}`;
        if (seenInUpload.has(uploadKey)) {
          failedCount++;
          errors.push(`Row ${rowNum} (${name}): Duplicate Batch Number "${batchNumber}" in the same upload file`);
          continue;
        }
        seenInUpload.add(uploadKey);

        // Check if the batch number already exists in the database for that same medicine
        const existingSameBatch = await prisma.inventoryItem.findFirst({
          where: {
            name: { equals: name, mode: 'insensitive' },
            batchNumber: batchNumber,
            NOT: { status: 'DELETED' }
          }
        });

        if (existingSameBatch) {
          failedCount++;
          errors.push(`Row ${rowNum} (${name}): Batch Number "${batchNumber}" already exists in the system database`);
          continue;
        }

        // 2. Insert into DB
        // Check if there is an existing parent item with the SAME name (case-insensitive)
        const parentItem = await prisma.inventoryItem.findFirst({
          where: {
            name: { equals: name, mode: 'insensitive' },
            NOT: { status: 'DELETED' }
          }
        });

        if (parentItem) {
          // Exists, create a new batch under this medicine
          const cleanBatch = batchNumber.replace(/[^a-zA-Z0-9]/g, '');
          const itemCode = `${parentItem.itemCode}_${cleanBatch}_${Date.now().toString().slice(-4)}`;

          const created = await prisma.inventoryItem.create({
            data: {
              itemCode,
              name: parentItem.name, // Keep casing identical
              genericName: parentItem.genericName,
              brandName: parentItem.brandName,
              category: raw.category || parentItem.category || 'TABLET',
              type: 'MEDICINE',
              dosage: raw.dosage || parentItem.dosage || '10mg',
              unit: parentItem.unit || 'Box',
              batchNumber,
              expiryDate: parsedExpiry,
              purchasePrice: price * 0.75, // 25% margin
              sellingPrice: price,
              stockQuantity: Math.floor(quantity),
              minThreshold: raw.minThreshold !== undefined ? Number(raw.minThreshold) : parentItem.minThreshold || 20,
              maxThreshold: parentItem.maxThreshold || 100,
              reorderLevel: parentItem.reorderLevel || 20,
              status: 'ACTIVE',
              shelfLocation: raw.shelfLocation || ''
            }
          });

          if (created.stockQuantity > 0) {
            await prisma.inventoryTransaction.create({
              data: {
                inventoryItemId: created.id,
                type: 'STOCK_IN',
                quantity: created.stockQuantity,
                performedBy: String(user),
                referenceId: 'BULK_UPLOAD'
              }
            });
          }
          createdCount++;
        } else {
          // Doesn't exist, create a completely new product
          const cleanName = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const itemCode = `MED-${cleanName.slice(0, 8)}-${Date.now().toString().slice(-4)}`;

          const created = await prisma.inventoryItem.create({
            data: {
              itemCode,
              name,
              genericName: name,
              brandName: '',
              category: raw.category || 'TABLET',
              type: 'MEDICINE',
              dosage: raw.dosage || '10mg',
              unit: 'Box',
              batchNumber,
              expiryDate: parsedExpiry,
              purchasePrice: price * 0.75,
              sellingPrice: price,
              stockQuantity: Math.floor(quantity),
              minThreshold: raw.minThreshold !== undefined ? Number(raw.minThreshold) : 20,
              maxThreshold: 100,
              reorderLevel: 20,
              status: 'ACTIVE',
              shelfLocation: raw.shelfLocation || ''
            }
          });

          if (created.stockQuantity > 0) {
            await prisma.inventoryTransaction.create({
              data: {
                inventoryItemId: created.id,
                type: 'STOCK_IN',
                quantity: created.stockQuantity,
                performedBy: String(user),
                referenceId: 'BULK_UPLOAD'
              }
            });
          }
          createdCount++;
        }
      }

      res.json({
        success: true,
        createdCount,
        skippedCount,
        failedCount,
        errors
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Error processing bulk upload' });
    }
  });


  // --- SEARCH API ENDPOINT ---
  app.get('/api/search', authenticateJWT, requireRole(['DOCTOR', 'RECEPTION', 'ADMIN', 'PHARMACY']), async (req: any, res: any) => {
    try {
      const q = (req.query.q || '').toString().trim();
      if (!q) {
        return res.json({ patients: [], tokens: [], consultations: [] });
      }

      const patients = await prisma.patient.findMany({
        where: {
          OR: [
            { id: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } }
          ]
        },
        take: 10
      });

      const tokens = await prisma.token.findMany({
        where: {
          OR: [
            { id: { contains: q, mode: 'insensitive' } },
            { tokenNumber: { contains: q, mode: 'insensitive' } },
            { patient: { name: { contains: q, mode: 'insensitive' } } },
            { patient: { id: { contains: q, mode: 'insensitive' } } }
          ]
        },
        include: {
          patient: true
        },
        take: 10
      });

      const consultations = await prisma.consultation.findMany({
        where: {
          OR: [
            { id: { contains: q, mode: 'insensitive' } },
            { diagnosis: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
            { patient: { name: { contains: q, mode: 'insensitive' } } },
            { doctor: { name: { contains: q, mode: 'insensitive' } } }
          ]
        },
        include: {
          patient: true,
          doctor: true
        },
        take: 10
      });

      res.json({ patients, tokens, consultations });
    } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  });


  // --- TASKS API ENDPOINTS ---
  app.get('/api/tasks', authenticateJWT, requireRole(['DOCTOR']), async (req: any, res: any) => {
    try {
      const tasks = await prisma.task.findMany({
        where: { doctorId: req.user.userId },
        orderBy: { createdAt: 'desc' }
      });
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  app.post('/api/tasks', authenticateJWT, requireRole(['DOCTOR']), async (req: any, res: any) => {
    try {
      const { title, description, priority, reminderDate } = req.body;
      const task = await prisma.task.create({
        data: {
          title,
          description: description || null,
          priority: priority || null,
          reminderDate: reminderDate || null,
          doctorId: req.user.userId
        }
      });
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  app.patch('/api/tasks/:id', authenticateJWT, requireRole(['DOCTOR']), async (req: any, res: any) => {
    try {
      const { title, description, priority, reminderDate, isCompleted } = req.body;
      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (priority !== undefined) updateData.priority = priority;
      if (reminderDate !== undefined) updateData.reminderDate = reminderDate;
      if (isCompleted !== undefined) updateData.isCompleted = isCompleted;

      await prisma.task.updateMany({
        where: { id: req.params.id, doctorId: req.user.userId },
        data: updateData
      });

      const updatedTask = await prisma.task.findFirst({
        where: { id: req.params.id, doctorId: req.user.userId }
      });
      res.json(updatedTask);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update task' });
    }
  });

  app.delete('/api/tasks/:id', authenticateJWT, requireRole(['DOCTOR']), async (req: any, res: any) => {
    try {
      await prisma.task.deleteMany({
        where: { id: req.params.id, doctorId: req.user.userId }
      });
      res.json({ success: true, id: req.params.id });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  // Seeds (if needed)
  seedInitialData(); // Spin off database verifying & seeding in background to prevent cold-starts/stale postgres from blocking web engine boot

  // --- API ROUTE SHIELD ---
  // Ensure any unmatched or incorrect /api/* routes always return structured JSON instead of HTML
  app.all('/api/*all', (req, res) => {
    res.status(404).json({ error: `API endpoint ${req.method} ${req.path} not found` });
  });

  // --- VITE MIDDLEWARE ---

  // Render environment usually defines RENDER=true
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  
  console.log(`Environment Info: NODE_ENV=${process.env.NODE_ENV}, RENDER=${process.env.RENDER}`);
  
  if (!isProduction) {
    console.log('Starting in DEVELOPMENT mode with Vite middleware');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('Starting in PRODUCTION mode serving static assets from dist/');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // --- GLOBAL EXPRESS ERROR HANDLER ---
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('[GLOBAL ERROR HANDLER]', err);
    
    const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
    const message = isProd ? 'An unexpected system error occurred on the clinical registry server.' : err.message;
    
    if (res.headersSent) {
      return next(err);
    }
    
    if (req.path.startsWith('/api')) {
      res.status(err.status || 500).json({
        error: message,
        ...(isProd ? {} : { stack: err.stack })
      });
    } else {
      res.status(err.status || 500).send(`
        <div style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2 style="color: #ea4335;">Clinical System Error</h2>
          <p>${message}</p>
          <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #001a48; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Return to Home</a>
        </div>
      `);
    }
  });

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT} [${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}]`);
  });
}

async function seedInitialData() {
  try {
    console.log('[SEED] Activating secure enterprise database verification and seeding sequence...');
    await withDbRetry(async () => {
      const count = await prisma.user.count();
      if (count === 0) {
        const defaultUsers = [
          { name: 'System Admin', email: 'admin@hospital.com', role: 'ADMIN', password: 'password123', employeeId: 'ADM-1001' },
          { name: 'Reception Desk', email: 'reception@hospital.com', role: 'RECEPTION', password: 'password123', employeeId: 'REC-1001' },
          { name: 'Dr. Sarah Connor', email: 'doctor@hospital.com', role: 'DOCTOR', password: 'DOC102938', department: 'General Medicine', employeeId: 'DOC-1001' },
          { name: 'Pharmacy Head', email: 'pharmacy@hospital.com', role: 'PHARMACY', password: 'password123', employeeId: 'PHR-1001' },
        ];
        
        const data = await Promise.all(
          defaultUsers.map(async (u) => ({
            ...u,
            password: await hashPassword(u.password)
          }))
        );

        await prisma.user.createMany({
          data
        });
      }

      // Ensure standard doctors exist for all departments in our live postgres database
      const additionalDoctors = [
        { name: 'Dr. Robert House', email: 'house@hospital.com', role: 'DOCTOR', password: 'password123', department: 'Cardiology', employeeId: 'DOC-1002' },
        { name: 'Dr. Marcus Welby', email: 'welby@hospital.com', role: 'DOCTOR', password: 'password123', department: 'Pediatrics', employeeId: 'DOC-1003' },
        { name: 'Dr. Terry Dubrow', email: 'dubrow@hospital.com', role: 'DOCTOR', password: 'password123', department: 'Dermatology', employeeId: 'DOC-1004' },
      ];

      for (const doc of additionalDoctors) {
        const existing = await prisma.user.findUnique({
          where: { email: doc.email }
        });
        if (!existing) {
          const docHash = await hashPassword(doc.password);
          await prisma.user.create({
            data: {
              ...doc,
              password: docHash
            }
          });
        }
      }

      // Dynamic Auto-healing Migration Script for Employee ID Standardization
      console.log('[AUDIT] Running Personnel Registry Security & Employee ID Standardization Audit...');
      const allDbUsers = await prisma.user.findMany();
      const usedEmployeeIds = new Set<string>();

      for (const u of allDbUsers) {
        if (u.employeeId && u.employeeId.trim() && u.employeeId.trim().toUpperCase() !== 'N/A') {
          usedEmployeeIds.add(u.employeeId.trim().toUpperCase());
        }
      }

      const prefixMap: Record<string, string> = {
        'ADMIN': 'ADM',
        'DOCTOR': 'DOC',
        'RECEPTION': 'REC',
        'PHARMACY': 'PHR'
      };

      for (const u of allDbUsers) {
        const isMissingId = !u.employeeId || !u.employeeId.trim() || u.employeeId.trim().toUpperCase() === 'N/A';
        if (isMissingId) {
          const role = (u.role || 'DOCTOR').toUpperCase();
          const prefix = prefixMap[role] || 'EMP';
          
          let sequenceNum = 1001;
          let candidateId = `${prefix}-${sequenceNum}`;
          
          while (usedEmployeeIds.has(candidateId.toUpperCase())) {
            sequenceNum++;
            candidateId = `${prefix}-${sequenceNum}`;
          }
          
          usedEmployeeIds.add(candidateId.toUpperCase());
          
          await prisma.user.update({
            where: { id: u.id },
            data: { employeeId: candidateId }
          });
          console.log(`[AUDIT] Assigned unique standard Employee ID "${candidateId}" to user "${u.name}" (${role})`);
        }
      }

      // Optional: Cleanup corrupted data (e.g. duplicate or orphan tokens without doctorQueue)
      // For this extreme fix, we'll ensure every active token has a corresponding DoctorQueue entry
      const tokensWithoutQueue = await prisma.token.findMany({
        where: { 
          doctorQueue: null,
          status: { not: 'CANCELLED' } 
        }
      });

      for (const t of tokensWithoutQueue) {
        // If it's a valid token, we can try to find or create a queue entry, 
        // but better to just mark them as cancelled or delete them if they are test junk
        await prisma.token.update({
          where: { id: t.id },
          data: { status: 'CANCELLED' }
        });
      }

      // Seed suppliers if empty
      const suppliersCount = await prisma.supplier.count();
      if (suppliersCount === 0) {
        await prisma.supplier.createMany({
          data: [
            { id: 'sup-1', name: 'Apex Pharma Logistics', contactPerson: 'John Apex', phone: '+1-555-0192', email: 'john@apexlogistics.com', address: '64 Industrial Parkway, Sector D' },
            { id: 'sup-2', name: 'Global Medical Supplies', contactPerson: 'Sarah Global', phone: '+1-555-0143', email: 'orders@globalmedical.com', address: '102 Bio Square, Tech District' },
            { id: 'sup-3', name: 'BioCare Therapeutics', contactPerson: 'Lisa Bio', phone: '+1-555-0275', email: 'orders@biocare.com', address: '12 Lab Lane, Pharma Valley' },
          ]
        });
      }

      // Seed inventory items if empty
      const inventoryCount = await prisma.inventoryItem.count();
      if (inventoryCount === 0) {
        const defaultExpiry = new Date();
        defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 2); // 2 years expiry

        const nearExpiry = new Date();
        nearExpiry.setMonth(nearExpiry.getMonth() + 1); // 1 month

        const alreadyExpired = new Date();
        alreadyExpired.setMonth(alreadyExpired.getMonth() - 2); // 2 months ago (expired!)

        await prisma.inventoryItem.createMany({
          data: [
            {
              itemCode: 'MED-PARA-500',
              name: 'Paracetamol 500mg',
              genericName: 'Paracetamol',
              brandName: 'Panadol',
              category: 'Analgesics',
              type: 'MEDICINE',
              dosage: '500mg',
              unit: 'Box of 100',
              batchNumber: 'BTCH-P129',
              expiryDate: defaultExpiry,
              supplierId: 'sup-1',
              purchasePrice: 2.50,
              sellingPrice: 5.00,
              stockQuantity: 120,
              minThreshold: 15,
              maxThreshold: 500,
              reorderLevel: 30,
              status: 'ACTIVE'
            },
            {
              itemCode: 'MED-AMOX-250',
              name: 'Amoxicillin 250mg',
              genericName: 'Amoxicillin',
              brandName: 'Amoxil',
              category: 'Antibiotics',
              type: 'MEDICINE',
              dosage: '250mg',
              unit: 'Box',
              batchNumber: 'BTCH-A392',
              expiryDate: defaultExpiry,
              supplierId: 'sup-1',
              purchasePrice: 8.50,
              sellingPrice: 15.00,
              stockQuantity: 8, // Under low stock (<= 10)
              minThreshold: 10,
              maxThreshold: 100,
              reorderLevel: 25,
              status: 'ACTIVE'
            },
            {
              itemCode: 'MED-CETI-10',
              name: 'Cetirizine 10mg',
              genericName: 'Cetirizine',
              brandName: 'Zyrtec',
              category: 'Antihistamines',
              type: 'MEDICINE',
              dosage: '10mg',
              unit: 'Box of 30',
              batchNumber: 'BTCH-C112',
              expiryDate: nearExpiry,
              supplierId: 'sup-2',
              purchasePrice: 3.20,
              sellingPrice: 7.50,
              stockQuantity: 65,
              minThreshold: 15,
              maxThreshold: 200,
              reorderLevel: 30,
              status: 'ACTIVE'
            },
            {
              itemCode: 'MED-INSU-GLAR',
              name: 'Insulin Glargine',
              genericName: 'Insulin Glargine',
              brandName: 'Lantus',
              category: 'Antidiabetics',
              type: 'MEDICINE',
              dosage: '100 U/mL',
              unit: 'Vial',
              batchNumber: 'BTCH-I409',
              expiryDate: defaultExpiry,
              supplierId: 'sup-3',
              purchasePrice: 22.00,
              sellingPrice: 45.00,
              stockQuantity: 4, // Under low stock (<= 5)
              minThreshold: 5,
              maxThreshold: 50,
              reorderLevel: 10,
              status: 'ACTIVE'
            },
            {
              itemCode: 'MED-ORS-SACH',
              name: 'Oral Rehydration Salts (ORS)',
              genericName: 'Oral Rehydration Salts (ORS)',
              brandName: 'Electral',
              category: 'Rehydration',
              type: 'MEDICINE',
              dosage: '21.8g Sachet',
              unit: 'Sachet Box',
              batchNumber: 'BTCH-O202',
              expiryDate: defaultExpiry,
              supplierId: 'sup-2',
              purchasePrice: 1.10,
              sellingPrice: 2.50,
              stockQuantity: 95,
              minThreshold: 20,
              maxThreshold: 300,
              reorderLevel: 40,
              status: 'ACTIVE'
            },
            {
              itemCode: 'CON-GLOV-L',
              name: 'Gloves Sterile (L)',
              genericName: 'Latex Gloves Size L',
              brandName: 'MediGrip',
              category: 'Consumables',
              type: 'CONSUMABLE',
              dosage: 'N/A',
              unit: 'Box of 100',
              batchNumber: 'BTCH-G199',
              expiryDate: alreadyExpired, // Expired!
              supplierId: 'sup-2',
              purchasePrice: 9.00,
              sellingPrice: 18.00,
              stockQuantity: 40,
              minThreshold: 10,
              maxThreshold: 100,
              reorderLevel: 15,
              status: 'ACTIVE'
            },
            {
              itemCode: 'CON-SYR-5ML',
              name: 'Syringes 5ml with Needle',
              genericName: 'Disposable Syringe 5ml',
              brandName: 'Dispovan',
              category: 'Consumables',
              type: 'CONSUMABLE',
              dosage: '5ml',
              unit: 'Box of 100',
              batchNumber: 'BTCH-S521',
              expiryDate: defaultExpiry,
              supplierId: 'sup-1',
              purchasePrice: 4.50,
              sellingPrice: 10.00,
              stockQuantity: 150,
              minThreshold: 25,
              maxThreshold: 500,
              reorderLevel: 50,
              status: 'ACTIVE'
            }
          ]
        });

        // populate stocking transaction history
        const seededItems = await prisma.inventoryItem.findMany();
        for (const item of seededItems) {
          await prisma.inventoryTransaction.create({
            data: {
              inventoryItemId: item.id,
              type: 'STOCK_IN',
              quantity: item.stockQuantity,
              performedBy: 'System Auto Seed',
              referenceId: 'INITIAL_SEED_CARGO'
            }
          });
        }
      }

      // Dynamic pricing self-healing migration logic for existing items/user-made items
      console.log('[AUDIT] Performing dynamic self-healing audit on inventory prices...');
      const itemsToHeal = await prisma.inventoryItem.findMany();
      for (const item of itemsToHeal) {
        if (!item.sellingPrice || item.sellingPrice <= 0) {
          let newSellingPrice = 15.0;
          let newPurchasePrice = 10.0;
          const nameLower = (item.name || '').toLowerCase();
          
          if (nameLower.includes('paracetamol')) {
            newSellingPrice = 5.0;
            newPurchasePrice = 4.0;
          } else if (nameLower.includes('amoxicillin')) {
            newSellingPrice = 8.9;
            newPurchasePrice = 7.0;
          } else if (nameLower.includes('syringe')) {
            newSellingPrice = 15.0;
            newPurchasePrice = 12.0;
          } else if (nameLower.includes('ibuprofen')) {
            newSellingPrice = 6.0;
            newPurchasePrice = 5.0;
          } else if (nameLower.includes('saline') || nameLower.includes('water')) {
            newSellingPrice = 25.0;
            newPurchasePrice = 20.0;
          } else if (nameLower.includes('insulin')) {
            newSellingPrice = 120.0;
            newPurchasePrice = 100.0;
          } else if (nameLower.includes('aspirin')) {
            newSellingPrice = 4.5;
            newPurchasePrice = 3.5;
          } else if (nameLower.includes('glove')) {
            newSellingPrice = 18.0;
            newPurchasePrice = 9.0;
          } else if (nameLower.includes('ors') || nameLower.includes('rehydration')) {
            newSellingPrice = 2.5;
            newPurchasePrice = 1.1;
          }
          
          await prisma.inventoryItem.update({
            where: { id: item.id },
            data: {
              sellingPrice: newSellingPrice,
              purchasePrice: newPurchasePrice
            }
          });
          console.log(`[AUDIT] Self-healed empty/0 price of "${item.name}" to Selling: ₹${newSellingPrice}, Purchase: ₹${newPurchasePrice}`);
        }
      }
    });
    console.log('[SEED] Web Application clinical seeding and checkups completed successfully.');
  } catch (err: any) {
    console.error('[SEED] Seeding error or target table busy (safely bypassed):', err.message || err);
  }
}

startServer();
