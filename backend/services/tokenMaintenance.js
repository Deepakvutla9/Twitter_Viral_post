const { listActiveAccounts } = require('./accounts');
const { checkToken, refreshToken } = require('./instagram');

// Keeps every active account's long-lived token alive. Instagram User tokens
// last ~60 days and refreshing extends them another ~60, so as long as this runs
// monthly no token lapses.
//
// Lives here rather than in server.js so the isolation below can be tested:
// server.js starts listening on require, which makes it untestable in process.

/**
 * One account failing must not stop the accounts after it. checkToken reports
 * failure by returning ok:false, but refreshToken can also throw outright — a
 * storage error, an unreadable row — and an uncaught throw here would end
 * maintenance for every remaining account.
 */
async function keepTokensFresh() {
  const summary = { accounts: 0, ok: 0, refreshed: 0, failed: 0 };

  let accounts;
  try {
    accounts = await listActiveAccounts();
  } catch (e) {
    console.warn(`[Instagram] ⚠ could not list accounts: ${e.message}`);
    summary.failed++;
    return summary;
  }

  summary.accounts = accounts.length;

  for (const account of accounts) {
    try {
      const tok = await checkToken(account);
      if (!tok.ok) {
        console.warn(
          `[Instagram] ⚠ TOKEN PROBLEM for ${account.slug} — posts will fail until fixed:\n           ${tok.error}`,
        );
        summary.failed++;
        continue;
      }
      summary.ok++;
      console.log(`[Instagram] Token OK — posting as @${tok.username} (${account.slug})`);

      const refreshed = await refreshToken(account);
      if (refreshed.ok) summary.refreshed++;
      else console.warn(`[Instagram] token refresh skipped for ${account.slug}: ${refreshed.error}`);
    } catch (e) {
      summary.failed++;
      console.warn(`[Instagram] ⚠ token maintenance failed for ${account.slug}: ${e.message}`);
    }
  }

  return summary;
}

module.exports = { keepTokensFresh };
