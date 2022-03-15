import fs from "fs";
import type pg from "pg";
import type pino from "pino";
import Pulsar from "pulsar-client";

export interface PulsarOauth2Config {
  // pulsar-client requires "type" but that seems unnecessary
  type: string;
  issuer_url: string;
  client_id?: string;
  client_secret?: string;
  private_key?: string;
  audience?: string;
  scope?: string;
}

export interface PulsarConfig {
  oauth2Config: PulsarOauth2Config;
  clientConfig: Pulsar.ClientConfig;
  consumerConfig: Pulsar.ConsumerConfig;
}

export interface HealthCheckConfig {
  port: number;
}

export interface Config {
  database: pg.ClientConfig;
  pulsar: PulsarConfig;
  healthCheck: HealthCheckConfig;
}

const getRequired = (envVariable: string) => {
  const variable = process.env[envVariable];
  if (typeof variable === "undefined") {
    throw new Error(`${envVariable} must be defined`);
  }
  return variable;
};

const getOptional = (envVariable: string) => process.env[envVariable];

const getOptionalBooleanWithDefault = (
  envVariable: string,
  defaultValue: boolean
) => {
  let result = defaultValue;
  const str = getOptional(envVariable);
  if (typeof str !== "undefined") {
    if (!["false", "true"].includes(str)) {
      throw new Error(`${envVariable} must be either "false" or "true"`);
    }
    result = str === "true";
  }
  return result;
};

const getDatabaseClientConfig = () => {
  const database = getOptional("POSTGRES_DB") || "postgres";
  const user = fs.readFileSync(getRequired("POSTGRES_USER_PATH"), "utf8");
  const password = fs.readFileSync(
    getRequired("POSTGRES_PASSWORD_PATH"),
    "utf8"
  );
  const host = getRequired("POSTGRES_HOST");
  const port = parseInt(getOptional("POSTGRES_PORT") || "5432", 10);
  const ssl = getOptionalBooleanWithDefault("POSTGRES_USE_SSL", true);
  return {
    database,
    user,
    password,
    host,
    port,
    ssl,
  };
};

const getPulsarOauth2Config = () => ({
  // pulsar-client requires "type" but that seems unnecessary
  type: "client_credentials",
  issuer_url: getRequired("PULSAR_OAUTH2_ISSUER_URL"),
  private_key: getRequired("PULSAR_OAUTH2_KEY_PATH"),
  audience: getRequired("PULSAR_OAUTH2_AUDIENCE"),
});

const createPulsarLog =
  (logger: pino.Logger) =>
  (
    level: Pulsar.LogLevel,
    file: string,
    line: number,
    message: string
  ): void => {
    switch (level) {
      case Pulsar.LogLevel.DEBUG:
        logger.debug({ file, line }, message);
        break;
      case Pulsar.LogLevel.INFO:
        logger.info({ file, line }, message);
        break;
      case Pulsar.LogLevel.WARN:
        logger.warn({ file, line }, message);
        break;
      case Pulsar.LogLevel.ERROR:
        logger.error({ file, line }, message);
        break;
      default: {
        const exhaustiveCheck: never = level;
        throw new Error(String(exhaustiveCheck));
      }
    }
  };

const getPulsarConfig = (logger: pino.Logger): PulsarConfig => {
  const oauth2Config = getPulsarOauth2Config();
  const serviceUrl = getRequired("PULSAR_SERVICE_URL");
  const tlsValidateHostname = getOptionalBooleanWithDefault(
    "PULSAR_TLS_VALIDATE_HOSTNAME",
    true
  );
  const log = createPulsarLog(logger);
  const topicsPattern = getRequired("PULSAR_TOPICS_PATTERN");
  const subscription = getRequired("PULSAR_SUBSCRIPTION");
  const subscriptionType = "Exclusive";
  const subscriptionInitialPosition = "Earliest";
  return {
    oauth2Config,
    clientConfig: {
      serviceUrl,
      tlsValidateHostname,
      log,
    },
    consumerConfig: {
      topicsPattern,
      subscription,
      subscriptionType,
      subscriptionInitialPosition,
    },
  };
};

const getHealthCheckConfig = () => {
  const port = parseInt(getOptional("HEALTH_CHECK_PORT") || "8080", 10);
  return { port };
};

export const getConfig = (logger: pino.Logger): Config => ({
  database: getDatabaseClientConfig(),
  pulsar: getPulsarConfig(logger),
  healthCheck: getHealthCheckConfig(),
});
