import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

import * as schema from '#/db/schema'

export async function createTestDatabase() {
  const client = createClient({ url: ':memory:' })

  await client.execute('PRAGMA foreign_keys = ON')

  const db = drizzle(client, { schema })

  await migrate(db, { migrationsFolder: './drizzle' })

  return { client, db }
}
