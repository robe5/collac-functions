import * as functions from "firebase-functions";
import { updateSerpJob } from "./updateSerpJob";

export const onCreateSerpJob = functions
  .region("europe-west1")
  .firestore.document("/serp-jobs/{documentId}")
  .onCreate(async (snap, context) => {
    const { state, batchId } = snap.data();
    const isDone = state === "done";

    if (!isDone) return;
    updateSerpJob(batchId, context.params.documentId);
  });
