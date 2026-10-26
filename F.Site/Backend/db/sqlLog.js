const EXECUTING = new Set(['run', 'get', 'all', 'iterate']);
export function attachSqlLogging(db, write) {
  const log = (sql, values) => {
    const ts = new Date().toISOString();
    write(`[${ts}] SQL: ${String(sql).trim()}\n`);
    if (values !== undefined && values.length > 0) {
      write(`[${ts}] Values: ${JSON.stringify(values)}\n`);
    }
  };
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql, ...rest) => {
    const stmt = originalPrepare(sql, ...rest);
    return new Proxy(stmt, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function' || !EXECUTING.has(prop)) return value;
        return (...args) => {
          log(sql, args);
          return value.apply(target, args);
        };
      },
    });
  };
  return db;
}