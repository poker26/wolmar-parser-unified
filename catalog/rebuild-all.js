/**
 * Полная пересборка каталога из текущих auction_lots. Запускать ПОСЛЕ bid-refresh
 * (когда финальные winning_bid дофинализированы), чтобы карточки/медианы подхватили
 * исправленные цены. Идемпотентно. Запуск: node catalog/rebuild-all.js
 */
const { execSync } = require("child_process");
const steps = ["purge-live", "build-imperial", "match-lots", "build-ussr", "build-foreign"];
for (const s of steps) {
  console.log(`\n========== ${s} ==========`);
  try {
    execSync(`node ${__dirname}/${s}.js`, { stdio: "inherit", cwd: __dirname + "/.." });
  } catch (e) {
    console.error(`!! ${s} FAILED: ${e.message}`);
    process.exit(1);
  }
}
console.log("\n✅ rebuild-all DONE");
