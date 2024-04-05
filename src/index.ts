import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as logs from "./logs";
import Stripe from "stripe";
import {
  // Product,
  // Price,
  // Subscription,
  CustomerData,
  // TaxRate,
} from "./interfaces";
import axios from "axios";
import { ContactsApi, ContactsApiApiKeys } from "@sendinblue/client";

export {
  onCreateSerpJob,
  onUpdateSerpJob,
  scheduleSerpsJobs,
} from "./serpJobs";
export { enqueueserptask, runserptask } from "./serpJobs/queue";

export { telegram } from "./telegram";

const apiVersion = "2020-08-27";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion,
  // Register extension as a Stripe plugin
  // https://stripe.com/docs/building-plugins#setappinfo
  appInfo: {
    name: "Firebase firestore-stripe-payments",
    version: "0.2.6",
  },
});

admin.initializeApp();
const db = admin.firestore();
// const { FieldValue } = admin.firestore;

const config = {
  syncUsersOnCreate: true,
  autoDeleteUsers: false,
  customersCollectionPath: "users",
};

async function calculateTermsStats(uid: string) {
  const querySnapshot = await admin
    .firestore()
    .collection("urls")
    .where("userId", "==", uid)
    .get();

  const totalTerms = querySnapshot.docs.length;

  const urls = querySnapshot.docs.map((doc) => {
    const data = doc.data();
    let url = data.url;
    try {
      url = new URL(data.url).hostname;
    } catch (error) {
      url = data.url;
    }
    return url;
  });
  const uniqueUrls = new Set(urls);

  return { totalUrls: uniqueUrls.size, totalTerms };
}

export const onUserUpdated = functions
  .region("europe-west1")
  .firestore.document("/users/{documentId}")
  .onUpdate(async (snap, context) => {
    const { email, stripeId } = snap.after.data();
    if (email === snap.before.get("email")) return;

    if (!stripeId) return;

    return stripe.customers.update(stripeId, { email: email });
  });

export const onCreateUrl = functions
  .region("europe-west1")
  .firestore.document("/urls/{documentId}")
  .onCreate(async (snap, context) => {
    const { userId } = snap.data();
    functions.logger.log("Adding url", context.params.documentId, userId);
    const { totalTerms, totalUrls } = await calculateTermsStats(userId);

    return db.collection("users").doc(userId).update({
      totalTerms: totalTerms,
      totalUrls: totalUrls,
    });
  });

export const onDeleteUrl = functions
  .region("europe-west1")
  .firestore.document("/urls/{documentId}")
  .onDelete(async (snap, context) => {
    const { userId } = snap.data();
    functions.logger.log("Removing url", context.params.documentId, userId);
    const { totalTerms, totalUrls } = await calculateTermsStats(userId);

    return db.collection("users").doc(userId).update({
      totalTerms: totalTerms,
      totalUrls: totalUrls,
    });
  });

/**
 * Cron job to scan serps.
 */
export const updateTermsRank = functions
  .region("europe-west1")
  .pubsub.schedule("every 2 minutes")
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

export const onGridscanUpdated = functions
  .region("europe-west1")
  .firestore.document("/gridscans/{documentId}")
  .onUpdate(async (snap, context) => {
    const { status, userId, location, keywords } = snap.after.data();

    const isCompleted =
      snap.before.get("status") !== status && status === "completed";

    if (isCompleted) {
      const template = location.dataCid
        ? "gridscan-completed"
        : "exploration-completed";
      const rankmap_url = location.dataCid
        ? `https://panel.collac.io/app/rankmaps/${context.params.documentId}`
        : `https://panel.collac.io/app/explorations/${context.params.documentId}`;

      const notificationsRef = db.doc(`users/${userId}/settings/notifications`);
      const notifications = await notificationsRef.get();
      if (
        notifications.exists &&
        notifications.get("notification_on_rankmap_completed")
      ) {
        db.collection("mail").add({
          // to: ["robe5.agf@gmail.com"],
          toUids: [userId],
          template: {
            name: template,
            data: {
              location_name: location.name,
              keywords,
              rankmap_url,
            },
          },
        });
        logs.emailSended(userId, rankmap_url);
      } else {
        logs.emailIgnored(userId, rankmap_url);
      }
    }
  });

/**
 * Create a customer object in Stripe when a user is created.
 */
const createCustomerRecord = async ({
  email,
  uid,
  phone,
}: {
  email?: string;
  phone?: string;
  uid: string;
}) => {
  try {
    logs.creatingCustomer(uid);
    const customerData: CustomerData = {
      metadata: {
        firebaseUID: uid,
      },
    };

    if (email) customerData.email = email;
    if (phone) customerData.phone = phone;
    const customer = await stripe.customers.create(customerData);
    // Add a mapping record in Cloud Firestore.
    const customerRecord = {
      name: customer.name,
      email: customer.email,
      stripeId: customer.id,
      stripeLink: `https://dashboard.stripe.com${
        customer.livemode ? "" : "/test"
      }/customers/${customer.id}`,
    };
    if (phone) (customerRecord as any).phone = phone;
    await admin
      .firestore()
      .collection(config.customersCollectionPath)
      .doc(uid)
      .set(customerRecord, { merge: true });
    logs.customerCreated(customer.id, customer.livemode);
    return customerRecord;
  } catch (error) {
    logs.customerCreationError(error as Error, uid);
    return null;
  }
};

const createSendinblueContact = async ({
  email,
  username,
}: {
  email: string;
  username?: string;
}) => {
  try {
    const apiInstance = new ContactsApi();

    apiInstance.setApiKey(
      ContactsApiApiKeys.apiKey,
      process.env.SENDING_BLUE_KEY!
    );
    await apiInstance.createContact({
      email: email,
      attributes: { FIRSTNAME: username },
    });
    console.info(`Usuario ${username} creado con email ${email}.`);
  } catch (error) {
    console.info(
      `No se ha podido crear el contacto ${username} con email ${email}.`
    );
  }
};
const updateSendinblueContact = async (email: string, subscribed: boolean) => {
  const apiInstance = new ContactsApi();
  apiInstance.setApiKey(
    ContactsApiApiKeys.apiKey,
    process.env.SENDING_BLUE_KEY!
  );
  const addToList = subscribed ? 12 : 13;
  const removeFromlist = subscribed ? 13 : 12;

  try {
    await apiInstance.addContactToList(addToList, {
      emails: [email],
    });
    console.info("añadido a lista ", addToList);
  } catch (e) {
    console.error("error añadiendo a lista ", addToList);
  }

  try {
    await apiInstance.removeContactFromList(removeFromlist, {
      emails: [email],
    });
    console.info("eliminado de la lista ", removeFromlist);
  } catch (e) {
    console.error("error eliminando de la lista ", removeFromlist);
  }
};

export const createCustomer = functions
  .region("europe-west1")
  .auth.user()
  .onCreate(async (user): Promise<void> => {
    if (!config.syncUsersOnCreate) return;
    const { email, uid, phoneNumber, displayName } = user;

    await createCustomerRecord({
      email,
      uid,
      phone: phoneNumber,
    });
    if (email) {
      await createSendinblueContact({ email, username: displayName });
      await updateSendinblueContact(email, false);
    }
  });

const deleteStripeCustomer = async ({
  uid,
  stripeId,
}: {
  uid: string;
  stripeId: string;
}) => {
  try {
    // Delete their customer object.
    // Deleting the customer object will immediately cancel all their active subscriptions.
    await stripe.customers.del(stripeId);
    logs.customerDeleted(stripeId);
    // Mark all their subscriptions as cancelled in Firestore.
    const update = {
      status: "canceled",
      ended_at: admin.firestore.Timestamp.now(),
    };
    // Set all subscription records to canceled.
    const subscriptionsSnap = await admin
      .firestore()
      .collection(config.customersCollectionPath)
      .doc(uid)
      .collection("subscriptions")
      .where("status", "in", ["trialing", "active"])
      .get();
    subscriptionsSnap.forEach((doc) => {
      doc.ref.set(update, { merge: true });
    });
  } catch (error: any) {
    logs.customerDeletionError(error, uid);
  }
};

/*
 * The `onUserDeleted` deletes their customer object in Stripe which immediately cancels all their subscriptions.
 */
export const onUserDeleted = functions.auth.user().onDelete(async (user) => {
  if (!config.autoDeleteUsers) return;
  // Get the Stripe customer id.
  const customer = (
    await admin.firestore().collection("users").doc(user.uid).get()
  ).data();
  // If you use the `delete-user-data` extension it could be the case that the customer record is already deleted.
  // In that case, the `onCustomerDataDeleted` function below takes care of deleting the Stripe customer object.
  if (customer) {
    await deleteStripeCustomer({ uid: user.uid, stripeId: customer.stripeId });
  }
});

/*
 * The `onCustomerDataDeleted` deletes their customer object in Stripe which immediately cancels all their subscriptions.
 */
export const onCustomerDataDeleted = functions.firestore
  .document(`/${config.customersCollectionPath}/{uid}`)
  .onDelete(async (snap, context) => {
    if (!config.autoDeleteUsers) return;
    const { stripeId } = snap.data();
    await deleteStripeCustomer({ uid: context.params.uid, stripeId });
  });

export const onSubscriptionCreated = functions.firestore
  .document("/subscriptions/{uid}")
  .onCreate(async (snap, context) => {
    const { uid } = context.params;
    console.info("Created subscription", uid);

    // Check status changed to 'active'
    const { status, current_period_start, current_period_end } = snap.data();
    // const { current_period_start: previous_period_start } = snap.data();
    console.info(
      "id",
      uid,
      status,
      "period_start",
      current_period_start,
      "-> ",
      current_period_end
    );

    const { user: userRef, items } = snap.data();
    const user = await userRef.get();
    await updateSendinblueContact(
      user.get("email"),
      status === "active" || status === "trialing"
    );

    if (status !== "active" && status !== "trialing") {
      console.info("Subscription status not active", status);
      return;
    }
    // if (current_period_start === previous_period_start) {
    //   console.info("current_period_start is not changed", current_period_start);
    //   return;
    // }
    if (new Date(current_period_end * 1000) < new Date()) {
      console.info(
        "Subscription current_period_end is not in the future",
        current_period_end
      );
      return;
    }

    // updating Credits
    console.info(
      "Updating user",
      userRef.id,
      "terms",
      +items[0].price.product.metadata.terms,
      "credits",
      +items[0].price.product.metadata.credits
    );
    userRef.update({
      planTerms: +items[0].price.product.metadata.terms,
      planCredits: +items[0].price.product.metadata.credits,
    });
  });

export const onSubscriptionUpdated = functions.firestore
  .document("/subscriptions/{uid}")
  .onUpdate(async (snap, context) => {
    const { uid } = context.params;
    console.info("Updated subscription", uid);

    // Check status changed to 'active'
    const { status, current_period_start, current_period_end } =
      snap.after.data();
    const { current_period_start: previous_period_start } = snap.before.data();
    console.info(
      "id",
      uid,
      status,
      "period_start",
      current_period_start,
      "-> ",
      current_period_end
    );

    const { user: userRef, items } = snap.after.data();
    const user = await userRef.get();
    await updateSendinblueContact(
      user.get("email"),
      status === "active" || status === "trialing"
    );

    if (snap.before.data().status === snap.after.data().status) {
      console.info(
        "Subscription status not changed",
        snap.before.data().status,
        snap.after.data().status
      );
      // return;
    }
    if (
      snap.after.data().status !== "active" &&
      snap.after.data().status !== "trialing"
    ) {
      console.info("Subscription status not active", status);
      return;
    }
    if (current_period_start === previous_period_start) {
      console.info("current_period_start is not changed", current_period_start);
      return;
    }
    if (new Date(current_period_end * 1000) < new Date()) {
      console.info(
        "Subscription current_period_end is not in the future",
        current_period_end
      );
      return;
    }

    // updating Credits
    console.info(
      "Updating user",
      userRef.id,
      "terms",
      +items[0].price.product.metadata.terms,
      "credits",
      +items[0].price.product.metadata.credits
    );
    userRef.update({
      planTerms: +items[0].price.product.metadata.terms,
      planCredits: +items[0].price.product.metadata.credits,
    });
  });

/** DEPRECATED */
/**
 * Create a CheckoutSession or PaymentIntent based on which client is being used.
 */
exports.createCheckoutSession = functions
  .region("europe-west1")
  .firestore.document(
    `/${config.customersCollectionPath}/{uid}/checkout_sessions/{id}`
  )
  .onCreate(async (snap, context) => {
    const {
      client = "web",
      amount,
      currency,
      mode = "subscription",
      price,
      success_url,
      cancel_url,
      quantity = 1,
      payment_method_types,
      shipping_rates = [],
      metadata = {},
      automatic_payment_methods = { enabled: true },
      automatic_tax = false,
      tax_rates = [],
      tax_id_collection = false,
      allow_promotion_codes = false,
      trial_from_plan = true,
      line_items,
      billing_address_collection = "required",
      collect_shipping_address = false,
      customer_update = {},
      locale = "auto",
      promotion_code,
      client_reference_id,
      setup_future_usage,
      after_expiration = {},
      consent_collection = {},
      expires_at,
      phone_number_collection = {},
    } = snap.data();
    try {
      logs.creatingCheckoutSession(context.params.id);
      // Get stripe customer id
      let customerRecord: any = (await snap.ref.parent.parent!.get()).data();

      if (!customerRecord?.stripeId) {
        const { email, phoneNumber } = await admin
          .auth()
          .getUser(context.params.uid);
        customerRecord = await createCustomerRecord({
          uid: context.params.uid,

          email,
          phone: phoneNumber,
        });
      }
      const customer = customerRecord.stripeId;

      if (client === "web") {
        // Get shipping countries
        // const shippingCountries: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] =
        //   collect_shipping_address
        //     ? (
        //         await admin
        //           .firestore()
        //           .collection(
        //             config.stripeConfigCollectionPath ||
        //               config.productsCollectionPath
        //           )
        //           .doc("shipping_countries")
        //           .get()
        //       ).data()?.["allowed_countries"] ?? []
        //     : [];
        const shippingCountries: any = collect_shipping_address ? [] : [];
        const sessionCreateParams: Stripe.Checkout.SessionCreateParams | any = {
          billing_address_collection,
          shipping_address_collection: { allowed_countries: shippingCountries },
          shipping_rates,
          customer,
          customer_update,
          line_items: line_items
            ? line_items
            : [
                {
                  price,
                  quantity,
                },
              ],
          mode,
          success_url,
          cancel_url,
          locale,
          after_expiration,
          consent_collection,
          phone_number_collection,
          ...(expires_at && { expires_at }),
        };
        if (payment_method_types) {
          sessionCreateParams.payment_method_types = payment_method_types;
        }
        if (mode === "subscription") {
          sessionCreateParams.subscription_data = {
            trial_from_plan,
            metadata,
          };
          if (!automatic_tax) {
            sessionCreateParams.subscription_data.default_tax_rates = tax_rates;
          }
        } else if (mode === "payment") {
          sessionCreateParams.payment_intent_data = {
            metadata,
            ...(setup_future_usage && { setup_future_usage }),
          };
        }
        if (automatic_tax) {
          sessionCreateParams.automatic_tax = {
            enabled: true,
          };
          sessionCreateParams.customer_update.name = "auto";
          sessionCreateParams.customer_update.address = "auto";
          sessionCreateParams.customer_update.shipping = "auto";
        }
        if (tax_id_collection) {
          sessionCreateParams.tax_id_collection = {
            enabled: true,
          };
          sessionCreateParams.customer_update.name = "auto";
          sessionCreateParams.customer_update.address = "auto";
          sessionCreateParams.customer_update.shipping = "auto";
        }
        if (promotion_code) {
          sessionCreateParams.discounts = [{ promotion_code }];
        } else {
          sessionCreateParams.allow_promotion_codes = allow_promotion_codes;
        }
        if (client_reference_id)
          sessionCreateParams.client_reference_id = client_reference_id;
        const session = await stripe.checkout.sessions.create(
          sessionCreateParams,
          { idempotencyKey: context.params.id }
        );
        await snap.ref.set(
          {
            client,
            mode,
            sessionId: session.id,
            url: session.url,
            created: admin.firestore.Timestamp.now(),
          },
          { merge: true }
        );
      } else if (client === "mobile") {
        let paymentIntentClientSecret = null;
        let setupIntentClientSecret = null;
        if (mode === "payment") {
          if (!amount || !currency) {
            throw new Error(
              "When using 'client:mobile' and 'mode:payment' you must specify amount and currency!"
            );
          }
          const paymentIntentCreateParams: Stripe.PaymentIntentCreateParams = {
            amount,
            currency,
            customer,
            metadata,
            ...(setup_future_usage && { setup_future_usage }),
          };
          if (payment_method_types) {
            paymentIntentCreateParams.payment_method_types =
              payment_method_types;
          } else {
            paymentIntentCreateParams.automatic_payment_methods =
              automatic_payment_methods;
          }
          const paymentIntent = await stripe.paymentIntents.create(
            paymentIntentCreateParams
          );
          paymentIntentClientSecret = paymentIntent.client_secret;
        } else if (mode === "setup") {
          const setupIntent = await stripe.setupIntents.create({
            customer,
            metadata,
            payment_method_types: payment_method_types ?? ["card"],
          });
          setupIntentClientSecret = setupIntent.client_secret;
        } else {
          throw new Error(
            `Mode '${mode} is not supported for 'client:mobile'!`
          );
        }
        const ephemeralKey = await stripe.ephemeralKeys.create(
          { customer },
          { apiVersion }
        );
        await snap.ref.set(
          {
            client,
            mode,
            customer,
            created: admin.firestore.Timestamp.now(),
            ephemeralKeySecret: ephemeralKey.secret,
            paymentIntentClientSecret,
            setupIntentClientSecret,
          },
          { merge: true }
        );
      } else {
        throw new Error(
          `Client ${client} is not supported. Only 'web' or ' mobile' is supported!`
        );
      }
      logs.checkoutSessionCreated(context.params.id);
      return;
    } catch (error: any) {
      logs.checkoutSessionCreationError(context.params.id, error);
      await snap.ref.set(
        { error: { message: error.message } },
        { merge: true }
      );
    }
  });
