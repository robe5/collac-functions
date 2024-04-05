import * as functions from "firebase-functions";
import { updateSerpJob } from "./updateSerpJob";

export const onUpdateSerpJob = functions
  .region("europe-west1")
  .firestore.document("/serp-jobs/{documentId}")
  .onUpdate(async (snap, context) => {
    const { state, batchId } = snap.after.data();

    const isDone = snap.before.get("state") !== state && state === "done";

    if (!isDone) return;
    updateSerpJob(batchId, context.params.documentId);
  });
