import pg from "pg";
import moment from "moment";

const createDatabaseConnection = async (config: pg.ClientConfig) => {
  // Correct pg date handling:
  // https://github.com/ThomWright/postgres-migrations/blob/dbfc5ccd7c71d77c24200d403cd72722017eca67/README.md#date-handling
  const parseDate = (val: string) =>
    val === null ? null : moment(val).format("YYYY-MM-DD");
  const DATATYPE_DATE = 1082;
  pg.types.setTypeParser(DATATYPE_DATE, (val) =>
    val === null ? null : parseDate(val)
  );
  const client = new pg.Client(config);
  await client.connect();
  return client;
};

export default createDatabaseConnection;
