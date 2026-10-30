/**
 * [INPUT]: 依赖 node:sqlite 与本机受限目录。
 * [OUTPUT]: 导出 Store；持久化凭据、健康记录和每日建议修订。
 * [POS]: server 唯一持久化入口；事务提交同步批次，拒绝跨账户混写。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";

export class Store {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    chmodSync(dataDir, 0o700);
    const filename = path.join(dataDir, "lifeos.sqlite");
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec(`
      PRAGMA journal_mode=DELETE;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS checkins (date TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans (
        target_date TEXT NOT NULL, time_zone TEXT NOT NULL, revision INTEGER NOT NULL,
        trigger TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (target_date, time_zone, revision)
      );
    `);
  }
  get(key, fallback = null) {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key, value) {
    this.db
      .prepare(
        "INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  remove(key) {
    this.db.prepare("DELETE FROM kv WHERE key=?").run(key);
  }
  records(kind) {
    return this.db
      .prepare("SELECT payload FROM records WHERE kind=?")
      .all(kind)
      .map((r) => JSON.parse(r.payload));
  }
  dataset() {
    return Object.fromEntries(
      ["cycles", "recoveries", "sleeps", "workouts"].map((k) => [
        k,
        this.records(k),
      ]),
    );
  }
  commitSync({
    profile,
    body,
    collections,
    startedAt,
    finishedAt,
    lookbackDays,
  }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get("profile");
      if (previous && previous.user_id !== profile.user_id) {
        throw new Error(
          "此数据目录已绑定另一 WHOOP 账户。请使用独立 DATA_DIR。",
        );
      }
      const upsert = this.db.prepare(
        "INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",
      );
      for (const [kind, records] of Object.entries(collections)) {
        for (const record of records)
          upsert.run(
            kind,
            String(kind === "recoveries" ? record.cycle_id : record.id),
            JSON.stringify(record),
          );
      }
      this.set("profile", profile);
      this.set("body", body);
      this.set("sync", {
        startedAt,
        finishedAt,
        lookbackDays,
        error: null,
        counts: Object.fromEntries(
          Object.entries(collections).map(([k, v]) => [k, v.length]),
        ),
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  checkins() {
    return this.db
      .prepare("SELECT payload FROM checkins ORDER BY date DESC")
      .all()
      .map((r) => JSON.parse(r.payload));
  }
  saveCheckin(checkin) {
    this.db
      .prepare(
        "INSERT INTO checkins VALUES (?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload",
      )
      .run(checkin.date, JSON.stringify(checkin));
  }
  plans(timeZone) {
    return this.db.prepare(`SELECT p.payload FROM plans p
      WHERE p.time_zone=? AND p.revision=(SELECT MAX(q.revision) FROM plans q
        WHERE q.target_date=p.target_date AND q.time_zone=p.time_zone)
      ORDER BY p.target_date DESC LIMIT 366`).all(timeZone).map((r) => JSON.parse(r.payload));
  }
  plan(date, timeZone) {
    const row = this.db.prepare("SELECT payload FROM plans WHERE target_date=? AND time_zone=? ORDER BY revision DESC LIMIT 1").get(date, timeZone);
    return row ? JSON.parse(row.payload) : null;
  }
  hasScheduledPlan(date, timeZone) {
    return this.db.prepare("SELECT payload FROM plans WHERE target_date=? AND time_zone=? AND trigger='scheduled'")
      .all(date, timeZone).some((row) => {
        const plan = JSON.parse(row.payload);
        return plan.publication ? plan.publication.state === "published" : true;
      });
  }
  latestPlanTime() {
    const row = this.db.prepare("SELECT payload FROM plans ORDER BY rowid DESC LIMIT 1").get();
    return row ? JSON.parse(row.payload).generatedAt : null;
  }
  savePlan(report) {
    const previous = this.plan(report.targetDate, report.timeZone);
    const saved = { ...report, revision: (previous?.revision || 0) + 1 };
    this.db.prepare("INSERT INTO plans VALUES (?,?,?,?,?)").run(saved.targetDate, saved.timeZone, saved.revision, saved.trigger, JSON.stringify(saved));
    return saved;
  }
  close() {
    this.db.close();
  }
}
