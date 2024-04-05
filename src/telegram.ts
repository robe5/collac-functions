import * as functions from "firebase-functions";
import * as express from "express";
import * as cors from "cors";

// give us the possibility of manage request properly
const app = express();

// Automatically allow cross-origin requests
app.use(cors({ origin: true }));

// our single entry point for every message
app.post("/", async (req, res) => {
  /*
    You can put the logic you want here
    the message receive will be in this
    https://core.telegram.org/bots/api#update
  */
  const isTelegramMessage =
    req.body &&
    req.body.message &&
    req.body.message.chat &&
    req.body.message.chat.id &&
    req.body.message.from &&
    req.body.message.from.first_name;

  if (isTelegramMessage) {
    const chat_id = req.body.message.chat.id;
    const { id, first_name } = req.body.message.from;

    if (chat_id == id)
      return res.status(200).send({
        method: "sendMessage",
        chat_id,
        text: `Hola ${first_name}, bienvenido a Collac. Tu ID de usuario es: ${chat_id}. Añádelo en las preferencias de Collac para vincularlo a tu usuario. ¡Gracias!.`,
      });
    return res.status(200);
  }

  return res.status(200).send({ status: "not a telegram message" });
});

// this is the only function it will be published in firebase
export const telegram = functions.region("europe-west1").https.onRequest(app);
