=== Subloop for WooCommerce ===
Contributors: subloop
Tags: woocommerce, stripe, payments, checkout
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Accept secure Stripe payments directly inside the classic WooCommerce checkout.

== Description ==

Subloop for WooCommerce keeps the customer on the store checkout while Stripe securely handles payment details. The WordPress site stores only a revocable Subloop connection token; Stripe secret keys remain in Subloop.

The checkout can show card payment and eligible express methods such as Apple Pay, Google Pay, Link, or Amazon Pay. Stripe decides which methods are available for the selected account, currency, browser, device, country, and domain.

This 1.0 release supports the classic WooCommerce checkout. Checkout Block support is not enabled yet.

== Installation ==

1. In Subloop, open WooCommerce under Integrations.
2. Enter the store name and public HTTPS store URL, select a Stripe account, and generate a connection.
3. Copy the one-time connection token.
4. In WordPress, go to Plugins, choose Add New, then Upload Plugin.
5. Upload subloop-woocommerce.zip and activate it.
6. Go to WooCommerce > Settings > Payments > Subloop.
7. Enable the gateway, paste the connection token, and save.

== Security ==

All order totals are calculated again on the WooCommerce server and verified by Subloop before an order is marked paid. Connection tokens are bound to the store URL and can be revoked from Subloop.

== Changelog ==

= 1.0.0 =
* Initial classic checkout integration.
* Embedded Stripe Payment Element and eligible express checkout methods.
* Signed server callback for payment status updates.
