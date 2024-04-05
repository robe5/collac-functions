import * as functions from "firebase-functions";
import { retrySerpJobs } from "./retrySerpJobs";

/**
 * Ensuring serps are finished
 */
export const scheduleSerpsJobs = functions
  .region("europe-west1")
  .pubsub.schedule("every 10 minutes")
  .onRun(async (context) => {
    retrySerpJobs();
  });
