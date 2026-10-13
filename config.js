require('dotenv').config();

const config = {
  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

  // Auth
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  cookieName: process.env.COOKIE_NAME || 'auth_token',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cookieMaxAgeMs: parseInt(process.env.COOKIE_MAX_AGE_MS, 10) || 604800000,

  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
};

// Fail fast if critical config is missing
if (!config.jwtSecret) {
  console.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}
if (!config.stripeSecretKey) {
  console.error('FATAL: STRIPE_SECRET_KEY is not set in .env');
  process.exit(1);
}

module.exports = config;
