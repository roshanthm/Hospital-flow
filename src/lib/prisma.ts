import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;

const globalForPrisma = global as unknown as { prisma: any };

// Robust PostgreSQL Connection Pool Configuration for production-grade resilience
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15, // Keep at most 15 clients in the pool
  idleTimeoutMillis: 10000, // Close idle clients after 10 seconds to prune potential stale/dead connections
  connectionTimeoutMillis: 15000, // Custom connection timeout: Allow up to 15 seconds for DB cold-starts
  keepAlive: true, // Keep-alive enabled to continuously test and maintain connection health
});

// Avoid crashes due to unexpected socket termination on idle clients
pool.on('error', (err) => {
  console.error('Unexpected connection pool socket error in pg adapter:', err);
});

const adapter = new PrismaPg(pool);

const basePrisma = new PrismaClient({
  adapter,
  log: ['query'],
});

const extendedPrisma = basePrisma.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      const start = Date.now();
      try {
        const result = await withDbRetry(() => query(args));
        const duration = Date.now() - start;
        if (duration > 250) { // Slow transaction / query threshold: 250ms
          const total = pool.totalCount;
          const idle = pool.idleCount;
          const active = total - idle;
          const waiting = pool.waitingCount;
          console.warn(`[TELEMETRY] SLOW QUERY: ${model || 'Raw'}.${operation} took ${duration}ms | Pool: total=${total}, active=${active}, idle=${idle}, waiting=${waiting}`);
        }
        return result;
      } catch (err: any) {
        const duration = Date.now() - start;
        console.error(`[TELEMETRY] QUERY ERROR: ${model || 'Raw'}.${operation} failed after ${duration}ms:`, err);
        throw err;
      }
    },
  },
});

export const prisma = (globalForPrisma.prisma || extendedPrisma) as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Executes a critical database query with exponential backoff on transient errors.
 * Ensures queries handle cold starts, wakeups, stale connections, or deadlock scenarios.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 4, delayMs = 1500): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const errMsg = String(err.message || err).toLowerCase();
      const errCode = String(err.code || '');
      
      const isTransient = 
        errMsg.includes('connection terminated') ||
        errMsg.includes('terminated unexpectedly') ||
        errMsg.includes('closed') ||
        errMsg.includes('etimedout') ||
        errMsg.includes('epipe') ||
        errMsg.includes('socket hang up') ||
        errMsg.includes('can\'t reach database') ||
        errMsg.includes('timeout') ||
        errMsg.includes('pool') ||
        errMsg.includes('deadlock') ||
        errCode === 'P1001' ||
        errCode === 'P1002' ||
        errCode === 'P1017' ||
        errCode === 'P2025';
        
      if (isTransient && attempt < retries) {
        console.warn(`[DATABASE RETRY] Transient database deviation on attempt ${attempt}/${retries}: ${err.message || err}. Reconnecting in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}
