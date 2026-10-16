import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const file = resolve(process.env.DATA_DIR || resolve(root, 'data'), 'waitlist.sqlite');
if (!existsSync(file)) {
  console.error('A lista ainda não existe. Inicie o servidor primeiro.');
  process.exit(1);
}
const db = new DatabaseSync(file, { readOnly: true });
// Prefix spreadsheet formula characters when exporting user-supplied cells.
const escape = (value) => '"' + String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
console.log('email,x_handle,created_at');
for (const row of db.prepare('SELECT email, x_handle, created_at FROM waitlist ORDER BY id').iterate()) {
  console.log([row.email, row.x_handle, row.created_at].map(escape).join(','));
}
db.close();
