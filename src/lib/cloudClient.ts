export async function callCloudFunction<T = any>(name: string, payload: any): Promise<T> {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('Cloud URL nicht konfiguriert');

  const url = `${base}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: any = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { /* ignore */ }

  if (!res.ok) {
    const message = data?.error || text || `Cloud-Fehler (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}
