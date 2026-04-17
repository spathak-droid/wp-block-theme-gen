const required = ['ANTHROPIC_API_KEY'] as const

type RequiredEnvKey = (typeof required)[number]

type Env = {
  [K in RequiredEnvKey]: string
} & {
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'
  SESSION_TTL_MS: number
  NODE_ENV: 'development' | 'test' | 'production'
}

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached

  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  const logLevel = (process.env.LOG_LEVEL ?? 'info') as Env['LOG_LEVEL']
  const sessionTtl = Number(process.env.SESSION_TTL_MS ?? '3600000')
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as Env['NODE_ENV']

  cached = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    LOG_LEVEL: logLevel,
    SESSION_TTL_MS: sessionTtl,
    NODE_ENV: nodeEnv,
  }
  return cached
}
