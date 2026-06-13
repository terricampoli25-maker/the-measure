# Serial Activation System Setup

This file contains the exact steps to deploy the Cloudflare worker, wire Stripe, and configure the app.

## 1. Generate signing keys

From `The Measure/Serial Activation System`:

```bash
node scripts/generate-keys.js
```

Copy the output:

- Private key -> set as `SIGNING_PRIVATE_KEY` in Cloudflare secrets
- Public key  -> paste into `The Measure/index.html` as `PUBLIC_KEY`

### App updates

In `The Measure/index.html`:
- `PUBLIC_KEY` must equal the generated public key
- `ACTIVATION_HOST` must point to your deployed worker URL

In `The Measure/electron/main.js`:
- `ACTIVATION_HOST` must use the same worker URL


## 2. Deploy Cloudflare Worker + D1 database

From `The Measure/Serial Activation System`:

```bash
wrangler d1 create serial-activation-db
wrangler d1 execute serial-activation-db --file=schema.sql
```

Set these secrets:

```bash
wrangler secret put SIGNING_PRIVATE_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY
```

Then deploy:

```bash
wrangler deploy
```

### Verify deploy

- Confirm `wrangler deploy` succeeds
- Confirm the deployed worker URL matches `ACTIVATION_HOST`
- Confirm the worker responds on:
  - `/activate`
  - `/checkin`
  - `/webhook/stripe`


## 3. Populate products in D1

The worker uses `session.metadata.product_code` from Stripe.

Run a SQL insert for your product code. Example:

```sql
INSERT INTO products (name, code, is_subscription)
VALUES ('The Measure', 'MEAS', 0);
```

- `code` becomes the serial prefix
- `is_subscription = 0` for one-time license
- `is_subscription = 1` for subscription license


## 4. Stripe Checkout session code

Use this server-side code to create checkout sessions and attach `product_code` metadata.

### One-time payment example

```js
import express from 'express';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-15' });
const app = express();
app.use(express.json());

app.post('/create-checkout-session', async (req, res) => {
  const { priceId, email } = req.body;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    metadata: {
      product_code: 'MEAS',
    },
    success_url: 'https://your-site.com/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://your-site.com/cancel',
  });

  res.json({ url: session.url });
});

app.listen(3000, () => console.log('Checkout server listening on port 3000'));
```

### Subscription example

```js
app.post('/create-subscription-session', async (req, res) => {
  const { priceId, email } = req.body;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    metadata: {
      product_code: 'MEAS',
    },
    success_url: 'https://your-site.com/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://your-site.com/cancel',
  });

  res.json({ url: session.url });
});
```

### Important Stripe details

- `metadata.product_code` must match the `code` inserted into `products`
- the worker reads the buyer email from `session.customer_details.email` or `session.customer_email`
- `checkout.session.completed` must reach the Cloudflare webhook


## 5. Configure Stripe webhook

In Stripe Dashboard:

- endpoint URL: `https://<your-worker-subdomain>.workers.dev/webhook/stripe`
- events to send:
  - `checkout.session.completed`
  - `customer.subscription.deleted`

Use the endpoint secret Stripe gives you as `STRIPE_WEBHOOK_SECRET`.


## 6. Update download link in worker email

In `Serial Activation System/worker/index.js`, change:

```js
const downloadUrl = 'https://github.com/terricampoli25-maker/the-measure/releases/download/v1.0.0/The%20Measure%20Setup%201.0.0.exe';
```

To your actual installer/download URL.


## 7. Test end-to-end

1. Create a Stripe checkout session in test mode.
2. Complete the payment using Stripe test cards.
3. Ensure the webhook fires and the worker logs `Serial issued:`.
4. Confirm the buyer receives the email with the serial and download link.
5. Launch the app and enter the serial on activation screen.
6. Confirm the app stores `sa_token`, `sa_machine_id`, and `sa_last_checkin`.


## 8. How activation is enforced per device

- The app generates `machineId` in localStorage.
- Activation sends `serial` + `machineId` to `/activate`.
- The worker stores each device in `activations`.
- If the serial is already activated on that device, it refreshes expiry.
- If the serial is new, it checks `max_activations` and then creates a row.

This is the per-device enforcement mechanism.


## 9. Quick configuration summary

- `PUBLIC_KEY` in `The Measure/index.html`
- `ACTIVATION_HOST` in both `The Measure/index.html` and `electron/main.js`
- `SIGNING_PRIVATE_KEY` secret on Cloudflare
- `STRIPE_WEBHOOK_SECRET` secret on Cloudflare
- `RESEND_API_KEY` secret on Cloudflare
- `products` row inserted into D1
- Stripe webhook pointing to `/webhook/stripe`
- Stripe metadata `product_code`
- download link updated in the worker
