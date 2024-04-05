import * as functions from "firebase-functions";
import axios from "axios";

export function retrySerpJobs() {
  functions.logger.log("Retrying serp jobs");

  const url = "https://ranktracker.vercel.app/api/serp/cron";
  // const url = "http://37fc-62-43-55-32.ngrok.io/api/serp/update";
  axios
    .get(url, {
      headers: {
        Authorization: "Bearer c94eb013-81a3-4320-8cf5-b6814ccf07bc",
      },
    })
    .then((res) => {
      // console.info("OK", Timestamp.now().toDate());
      functions.logger.log("OK retrying jobs", res);
    })
    .catch((err) => {
      // console.info("Error", err, Timestamp.now());
      functions.logger.error("Error retrying serp jobs", err);
    });
}
