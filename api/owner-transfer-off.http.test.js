// Pasar el rol de dueño con OWNER_TRANSFER_ENABLED=false: el mismo archivo, en modo apagado.
process.env.OWNER_TRANSFER_TEST_OFF = '1';
await import('./owner-transfer.http.test.js');
