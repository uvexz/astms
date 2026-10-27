import '@tanstack/react-start/server-only'

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

import * as schema from './schema.ts'

const url = process.env.DATABASE_URL

if (!url) {
  throw new Error('DATABASE_URL is not configured')
}

export const client = createClient({
  url,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
})

await client.execute('PRAGMA foreign_keys = ON')

export const db = drizzle(client, { schema })

export type Database = typeof db
