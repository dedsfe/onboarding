-- Lista de espera do site (Cloudflare D1). Um e-mail entra uma vez só.
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  x_handle TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
