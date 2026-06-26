/**
 * One-off data wipe for Bullfrog Salutes.
 *
 * This is NOT exposed over the web. It can only be run by someone with shell
 * access to the server (i.e. the owner, from Cowork, via the Railway console):
 *
 *     node wipe.js
 *
 * It deletes every member and all related records. There is no undo.
 */
const db = require('./database');

const n = db.prepare('SELECT COUNT(*) as n FROM members').get().n;
const wipe = db.transaction(() => {
  db.prepare('DELETE FROM device_registrations').run();
  db.prepare('DELETE FROM pint_redemptions').run();
  db.prepare('DELETE FROM birthday_redemptions').run();
  db.prepare('DELETE FROM members').run();
});
wipe();
console.log(`Wiped ${n} member(s) and all related data.`);
