const shared = {
  use_env_variable: process.env.DATABASE_URL ? "DATABASE_URL" : undefined,
  dialect: "postgres",
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT || 5432,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD || undefined,
  database: process.env.DATABASE_NAME,
};

module.exports = {
  development: shared,
  test: shared,
  "production-ssl-disabled": shared,
  production: {
    ...shared,
    dialectOptions: {
      // Matches the application behavior in server/storage/database.ts so
      // that PGSSLMODE=disable also applies to migrations, e.g. when the
      // database runs on a trusted private network without TLS.
      ssl:
        process.env.PGSSLMODE === "disable"
          ? false
          : {
              rejectUnauthorized: false,
            },
    },
  },
};
