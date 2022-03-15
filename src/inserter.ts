import type Pulsar from "pulsar-client";
import type pg from "pg";

// FIXME: Consider sharing types
// Copied from waltti-apc-aggregation-test-data-generator

interface CoreAggregateApcData {
  feedPublisherId: string;
  tripId: string;
  startDate: string;
  startTime: string;
  routeId: string;
  directionId: number;
  countingVendorName: string;
  timezoneName: string;
}

export type CountClass =
  | "adult"
  | "child"
  | "pram"
  | "bike"
  | "wheelchair"
  | "other";

export interface DoorClassCount {
  doorNumber: number;
  countClass: CountClass;
  in: number;
  out: number;
}

interface StopAndDoorsAggregateApcData {
  stopId: string;
  stopSequence: number;
  doorClassCounts: DoorClassCount[];
}

type AggregateApcData = CoreAggregateApcData & StopAndDoorsAggregateApcData;

type UpsertStopVisitParameterArray = [
  string, // feed_publisher_id text
  string, // stop_id text
  string, // timezone_name text
  string, // route_id text
  string, // trip_id text
  string, // start_operating_date date
  string, // start_operating_time interval HOUR TO SECOND
  number, // direction_id smallint
  number // stop_sequence smallint
];

type UpsertDoorCountParameterArrayWithoutUniqueStopVisitId = [
  string, // counting_vendor_name text
  number, // door_number smallint
  string, // count_class text
  number, // count_door_in smallint
  number // count_door_out smallint
];

interface CombinedSqlParameters {
  stopVisit: UpsertStopVisitParameterArray;
  partialDoorCounts: UpsertDoorCountParameterArrayWithoutUniqueStopVisitId[];
}

const transformIntoSqlParameters = (
  message: Pulsar.Message
): CombinedSqlParameters => {
  // FIXME: validate the parsed data
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const parsed: AggregateApcData = JSON.parse(message.getData().toString());
  const stopVisit: UpsertStopVisitParameterArray = [
    parsed.feedPublisherId,
    parsed.stopId,
    parsed.timezoneName,
    parsed.routeId,
    parsed.tripId,
    parsed.startDate,
    // Make startTime a PostgreSQL interval (ISO 8601 duration) as the value may
    // exceed 24 hours.
    `PT${parsed.startTime}`,
    parsed.directionId,
    parsed.stopSequence,
  ];
  const partialDoorCounts: UpsertDoorCountParameterArrayWithoutUniqueStopVisitId[] =
    parsed.doorClassCounts.map((doorClassCount) => [
      parsed.countingVendorName,
      doorClassCount.doorNumber,
      doorClassCount.countClass,
      doorClassCount.in,
      doorClassCount.out,
    ]);
  return {
    stopVisit,
    partialDoorCounts,
  };
};

const upsertStopVisitQuery =
  "SELECT apc_gtfs.upsert_stop_visit($1, $2, $3, $4, $5, $6, $7, $8, $9);";

const upsertDoorCountQuery =
  "SELECT apc_occupancy.upsert_door_count($1, $2, $3, $4, $5, $6);";

export const keepConsumingAndInserting = async (
  databaseClient: pg.Client,
  pulsarConsumer: Pulsar.Consumer
) => {
  // forEach cannot handle async functions.
  /* eslint-disable no-await-in-loop */
  for (;;) {
    const message = await pulsarConsumer.receive();
    const { stopVisit, partialDoorCounts } =
      transformIntoSqlParameters(message);
    const stopVisitResult = await databaseClient.query(
      upsertStopVisitQuery,
      stopVisit
    );
    if (!stopVisitResult.rows?.length) {
      throw new Error(
        `Failed to get a result from query ${upsertStopVisitQuery}`
      );
    }
    // FIXME: Do this cleaner:
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const uniqueStopVisitId = Object.values(stopVisitResult.rows[0])[0];
    // forEach cannot handle async functions.
    // eslint-disable-next-line no-restricted-syntax
    for (const partialParameters of partialDoorCounts) {
      const upsertDoorCountParameters = [uniqueStopVisitId].concat(
        partialParameters
      );
      await databaseClient.query(
        upsertDoorCountQuery,
        upsertDoorCountParameters
      );
    }
    await pulsarConsumer.acknowledge(message);
  }
  /* eslint-enable no-await-in-loop */
};
