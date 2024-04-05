import * as functions from "firebase-functions";
import axios from "axios";

export function updateSerpJob(batchId: string, documentId: string) {
  functions.logger.log("Updating serp job", documentId, batchId);

  const url = "https://ranktracker.vercel.app/api/serp/update";
  // const url = "http://37fc-62-43-55-32.ngrok.io/api/serp/update";
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
      functions.logger.log("Updated serp job", documentId, batchId, res);
    })
    .catch((err) => {
      console.info("Error", err, new Date());
      functions.logger.log("Error updating serp job", documentId, batchId, err);
    });
}
