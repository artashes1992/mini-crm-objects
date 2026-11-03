import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Во фронтенде только публичный (publishable) ключ: он ничего не открывает сам по себе,
// все права проверяет база (RLS и функции). Секретный ключ сюда не попадает никогда.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  throw new Error('Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY (см. .env.example)')
}

export const supabase = createClient<Database>(url, key)
