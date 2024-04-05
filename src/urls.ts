import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

import axios from "axios";

const db = admin.firestore();
const { FieldValue } = admin.firestore;

export const onCreateUrl = functions
  .region("europe-west1")
  .firestore.document("/urls/{documentId}")
  .onCreate(async (snap, context) => {
    const { userId } = snap.data();
    functions.logger.log("Adding url", context.params.documentId, userId);
    return db
      .collection("users")
      .doc(userId)
      .update({
        totalUrls: FieldValue.increment(1),
      });
  });

export const onDeleteUrl = functions
  .region("europe-west1")
  .firestore.document("/urls/{documentId}")
  .onDelete(async (snap, context) => {
    const { userId } = snap.data();
    functions.logger.log("Removing url", context.params.documentId, userId);
    return db
      .collection("users")
      .doc(userId)
      .update({
        totalUrls: FieldValue.increment(-1),
      });
  });

export const updateTermsRank = functions
  .region("europe-west1")
  .pubsub.schedule("every 1 minutes")
  .onRun(async (context) => {
    console.info("Actualizando term ranks", new Date());
    const url = "https://ranktracker.vercel.app/api/cron";
    axios
      .post(
        url,
        {},
        {
          headers: {
            Authorization: "Bearer c94eb013-81a3-4320-8cf5-b6814ccf07bc",
          },
        }
      )
      .then((res) => {
        console.info("OK", new Date());
      })
      .catch((err) => {
        console.info("Error", err, new Date());
      });
  });

export const onUpdateSerpJob = functions
  .region("europe-west1")
  .firestore.document("/serp-jobs/{documentId}")
  .onUpdate(async (snap, context) => {
    const { state, batchId } = snap.after.data();

    const isDone = snap.before.get("state") !== state && state === "done";

    if (!isDone) return;

    functions.logger.log(
      "Updating serp job",
      context.params.documentId,
      batchId
    );

    const url = "https://ranktracker.vercel.app/api/serp/update";
    axios
      .post(
        url,
        { batchId },
        {
          headers: {
            Authorization: "Bearer c94eb013-81a3-4320-8cf5-b6814ccf07bc",
          },
        }
      )
      .then((res) => {
        console.info("OK", new Date());
        functions.logger.log(
          "Updated serp job",
          context.params.documentId,
          batchId,
          res
        );
      })
      .catch((err) => {
        console.info("Error", err, new Date());
        functions.logger.log(
          "Error updating serp job",
          context.params.documentId,
          batchId,
          err
        );
      });
  });
