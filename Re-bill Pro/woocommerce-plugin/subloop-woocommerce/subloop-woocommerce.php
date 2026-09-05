<?php
/**
 * Plugin Name: Subloop for WooCommerce
 * Description: Accept secure Stripe payments directly inside WooCommerce checkout through a Subloop connection.
 * Version: 1.1.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * WC requires at least: 8.0
 * WC tested up to: 10.1
 * Author: Subloop
 * Text Domain: subloop-woocommerce
 */

defined('ABSPATH') || exit;

define('SUBLOOP_WC_VERSION', '1.1.0');
define('SUBLOOP_WC_FILE', __FILE__);

add_action('before_woocommerce_init', static function () {
    if (class_exists(Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
        Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, false);
    }
});

add_action('plugins_loaded', static function () {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }

    class WC_Gateway_Subloop extends WC_Payment_Gateway
    {
        private $connection_token;
        private $api_base = 'https://app.subloop.space';

        public function __construct()
        {
            $this->id = 'subloop';
            $this->method_title = __('Subloop', 'subloop-woocommerce');
            $this->method_description = __('Secure card and wallet payments inside WooCommerce checkout.', 'subloop-woocommerce');
            $this->has_fields = true;
            $this->supports = array('products', 'subscriptions');
            $this->init_form_fields();
            $this->init_settings();
            $this->enabled = $this->get_option('enabled', 'no');
            $this->title = __('Card payment', 'subloop-woocommerce');
            $this->description = '';
            $this->connection_token = trim((string) $this->get_option('connection_token', ''));
            $this->api_base = untrailingslashit((string) apply_filters('subloop_woocommerce_api_base', $this->api_base));

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
            add_action('wp_enqueue_scripts', array($this, 'enqueue_checkout_assets'));
        }

        public function init_form_fields()
        {
            $this->form_fields = array(
                'enabled' => array(
                    'title' => __('Enable', 'subloop-woocommerce'),
                    'type' => 'checkbox',
                    'label' => __('Enable card payment through Subloop', 'subloop-woocommerce'),
                    'default' => 'no',
                ),
                'connection_token' => array(
                    'title' => __('Connection token', 'subloop-woocommerce'),
                    'type' => 'password',
                    'description' => __('Generate this token on the WooCommerce page in your Subloop app.', 'subloop-woocommerce'),
                    'desc_tip' => true,
                    'default' => '',
                ),
                'billing_interval_count' => array(
                    'title' => __('Charge every', 'subloop-woocommerce'),
                    'type' => 'number',
                    'description' => __('Fallback schedule for normal WooCommerce products. Product schedules are detected automatically.', 'subloop-woocommerce'),
                    'default' => '1',
                    'custom_attributes' => array('min' => '1', 'max' => '365', 'step' => '1'),
                ),
                'billing_interval' => array(
                    'title' => __('Billing period', 'subloop-woocommerce'),
                    'type' => 'select',
                    'default' => 'month',
                    'options' => array(
                        'day' => __('Day(s)', 'subloop-woocommerce'),
                        'week' => __('Week(s)', 'subloop-woocommerce'),
                        'month' => __('Month(s)', 'subloop-woocommerce'),
                        'year' => __('Year(s)', 'subloop-woocommerce'),
                    ),
                ),
            );
        }

        public function admin_options()
        {
            echo '<h2>' . esc_html__('Subloop for WooCommerce', 'subloop-woocommerce') . '</h2>';
            echo '<p>' . esc_html__('Paste the connection token generated in Subloop. The Stripe secret key remains in Subloop and is never stored in WordPress.', 'subloop-woocommerce') . '</p>';
            echo '<table class="form-table">';
            $this->generate_settings_html();
            echo '</table>';
        }

        public function process_admin_options()
        {
            $saved = parent::process_admin_options();
            delete_transient('subloop_wc_config_' . md5($this->connection_token));
            return $saved;
        }

        public function is_available()
        {
            if ('yes' !== $this->enabled || !$this->connection_token || !is_checkout()) {
                return false;
            }
            return parent::is_available() && !empty($this->get_remote_config()['publishable_key']);
        }

        private function request_headers()
        {
            return array(
                'Authorization' => 'Bearer ' . $this->connection_token,
                'X-Subloop-Store-URL' => home_url('/'),
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
            );
        }

        private function api_request($method, $path, $body = null)
        {
            $args = array(
                'method' => $method,
                'timeout' => 20,
                'headers' => $this->request_headers(),
            );
            if (null !== $body) {
                $args['body'] = wp_json_encode($body);
            }
            $response = wp_remote_request($this->api_base . $path, $args);
            if (is_wp_error($response)) {
                return $response;
            }
            $status = (int) wp_remote_retrieve_response_code($response);
            $data = json_decode(wp_remote_retrieve_body($response), true);
            if ($status < 200 || $status >= 300 || !is_array($data)) {
                return new WP_Error('subloop_api_error', is_array($data) && !empty($data['error']) ? sanitize_text_field($data['error']) : __('Unable to contact the payment service.', 'subloop-woocommerce'));
            }
            return $data;
        }

        private function get_remote_config()
        {
            $cache_key = 'subloop_wc_config_' . md5($this->connection_token);
            $cached = get_transient($cache_key);
            if (is_array($cached)) {
                return $cached;
            }
            $config = $this->api_request('GET', '/woocommerce/v1/config');
            if (is_wp_error($config)) {
                return array();
            }
            set_transient($cache_key, $config, 5 * MINUTE_IN_SECONDS);
            return $config;
        }

        public function enqueue_checkout_assets()
        {
            if (!is_checkout() || is_order_received_page() || 'yes' !== $this->enabled || !$this->connection_token) {
                return;
            }
            $config = $this->get_remote_config();
            if (empty($config['publishable_key'])) {
                return;
            }
            wp_enqueue_script('stripe-js', 'https://js.stripe.com/v3/', array(), null, true);
            wp_enqueue_script('subloop-wc-checkout', plugins_url('assets/js/checkout.js', __FILE__), array('jquery', 'stripe-js', 'wc-checkout'), SUBLOOP_WC_VERSION, true);
            wp_enqueue_style('subloop-wc-checkout', plugins_url('assets/css/checkout.css', __FILE__), array(), SUBLOOP_WC_VERSION);
            wp_localize_script('subloop-wc-checkout', 'SubloopWC', array(
                'ajaxUrl' => WC_AJAX::get_endpoint('subloop_prepare_payment'),
                'nonce' => wp_create_nonce('subloop_wc_checkout'),
                'publishableKey' => sanitize_text_field($config['publishable_key']),
                'gatewayId' => $this->id,
                'errorMessage' => __('Payment could not be completed. Please check your details and try again.', 'subloop-woocommerce'),
                'emailMessage' => __('Enter a valid email address to load the payment form.', 'subloop-woocommerce'),
            ));
        }

        public function payment_fields()
        {
            echo '<div id="subloop-payment-ui">';
            echo '<div id="subloop-express-element"></div>';
            echo '<div id="subloop-payment-divider"><span>' . esc_html__('Or pay another way', 'subloop-woocommerce') . '</span></div>';
            echo '<div id="subloop-payment-element"></div>';
            echo '<div id="subloop-payment-error" role="alert" aria-live="polite"></div>';
            echo '<input type="hidden" name="subloop_payment_intent_id" id="subloop-payment-intent-id" value="">';
            echo '<input type="hidden" name="subloop_subscription_id" id="subloop-subscription-id" value="">';
            $schedule = $this->billing_schedule();
            if (!is_wp_error($schedule) && WC()->cart) {
                $count = max(1, absint($schedule['interval_count']));
                $unit = sanitize_key((string) $schedule['interval']);
                $unit_label = $count === 1 ? $unit : $unit . 's';
                $frequency = $count === 1 ? $unit_label : $count . ' ' . $unit_label;
                $amount_html = wc_price(WC()->cart->get_total('edit'));
                echo '<div id="subloop-payment-schedule">' . wp_kses_post(sprintf(__('Today: %1$s. Future payments: %1$s every %2$s until canceled.', 'subloop-woocommerce'), $amount_html, esc_html($frequency))) . '</div>';
            }
            echo '</div>';
        }

        private function minor_amount($amount)
        {
            return (int) round(((float) $amount) * pow(10, wc_get_price_decimals()));
        }

        private function billing_schedule()
        {
            $detected = array();
            if (WC()->cart) {
                foreach (WC()->cart->get_cart() as $item) {
                    $product = isset($item['data']) ? $item['data'] : null;
                    if (!$product) continue;
                    $period = sanitize_key((string) $product->get_meta('_subscription_period', true));
                    $count = absint($product->get_meta('_subscription_period_interval', true));
                    if (!$period && $product->is_type('variation')) {
                        $parent = wc_get_product($product->get_parent_id());
                        if ($parent) {
                            $period = sanitize_key((string) $parent->get_meta('_subscription_period', true));
                            $count = absint($parent->get_meta('_subscription_period_interval', true));
                        }
                    }
                    if (in_array($period, array('day', 'week', 'month', 'year'), true)) {
                        $detected[$period . ':' . max(1, $count)] = array('interval' => $period, 'interval_count' => max(1, $count));
                    }
                }
            }
            if (count($detected) > 1) {
                return new WP_Error('subloop_mixed_intervals', __('All products in one cart must use the same payment schedule.', 'subloop-woocommerce'));
            }
            if ($detected) return reset($detected);
            $period = sanitize_key((string) $this->get_option('billing_interval', 'month'));
            if (!in_array($period, array('day', 'week', 'month', 'year'), true)) $period = 'month';
            return array('interval' => $period, 'interval_count' => max(1, absint($this->get_option('billing_interval_count', '1'))));
        }

        public function prepare_payment()
        {
            check_ajax_referer('subloop_wc_checkout', 'nonce');
            if (!WC()->cart || WC()->cart->is_empty()) {
                wp_send_json_error(array('message' => __('Your cart is empty.', 'subloop-woocommerce')), 400);
            }
            $schedule = $this->billing_schedule();
            if (is_wp_error($schedule)) {
                wp_send_json_error(array('message' => $schedule->get_error_message()), 400);
            }
            $amount = $this->minor_amount(WC()->cart->get_total('edit'));
            $currency = strtolower(get_woocommerce_currency());
            $checkout_email = isset($_POST['billing_email']) ? sanitize_email(wp_unslash($_POST['billing_email'])) : '';
            $signature = hash('sha256', implode('|', array(WC()->cart->get_cart_hash(), $amount, $currency, $schedule['interval'], $schedule['interval_count'], strtolower($checkout_email))));
            $reference = WC()->session->get('subloop_checkout_reference');
            if (!$reference || WC()->session->get('subloop_checkout_signature') !== $signature) {
                $reference = 'wc_' . str_replace('-', '', wp_generate_uuid4());
                WC()->session->set('subloop_checkout_reference', $reference);
                WC()->session->set('subloop_checkout_signature', $signature);
            }
            $payload = array(
                'checkout_reference' => $reference,
                'amount' => $amount,
                'currency' => $currency,
                'interval' => $schedule['interval'],
                'interval_count' => $schedule['interval_count'],
                'customer' => array(
                    'first_name' => isset($_POST['billing_first_name']) ? sanitize_text_field(wp_unslash($_POST['billing_first_name'])) : '',
                    'last_name' => isset($_POST['billing_last_name']) ? sanitize_text_field(wp_unslash($_POST['billing_last_name'])) : '',
                    'email' => $checkout_email,
                    'phone' => isset($_POST['billing_phone']) ? sanitize_text_field(wp_unslash($_POST['billing_phone'])) : '',
                    'address' => array(
                        'line1' => isset($_POST['billing_address_1']) ? sanitize_text_field(wp_unslash($_POST['billing_address_1'])) : '',
                        'line2' => isset($_POST['billing_address_2']) ? sanitize_text_field(wp_unslash($_POST['billing_address_2'])) : '',
                        'city' => isset($_POST['billing_city']) ? sanitize_text_field(wp_unslash($_POST['billing_city'])) : '',
                        'state' => isset($_POST['billing_state']) ? sanitize_text_field(wp_unslash($_POST['billing_state'])) : '',
                        'postal_code' => isset($_POST['billing_postcode']) ? sanitize_text_field(wp_unslash($_POST['billing_postcode'])) : '',
                        'country' => isset($_POST['billing_country']) ? sanitize_text_field(wp_unslash($_POST['billing_country'])) : '',
                    ),
                ),
            );
            $result = $this->api_request('POST', '/woocommerce/v1/subscriptions', $payload);
            if (is_wp_error($result)) {
                wp_send_json_error(array('message' => $result->get_error_message()), 400);
            }
            wp_send_json_success($result);
        }

        public function validate_fields()
        {
            $intent_id = isset($_POST['subloop_payment_intent_id']) ? sanitize_text_field(wp_unslash($_POST['subloop_payment_intent_id'])) : '';
            $subscription_id = isset($_POST['subloop_subscription_id']) ? sanitize_text_field(wp_unslash($_POST['subloop_subscription_id'])) : '';
            if (!$intent_id || !$subscription_id) {
                wc_add_notice(__('Please complete the payment details.', 'subloop-woocommerce'), 'error');
                return false;
            }
            return true;
        }

        public function process_payment($order_id)
        {
            $order = wc_get_order($order_id);
            $intent_id = isset($_POST['subloop_payment_intent_id']) ? sanitize_text_field(wp_unslash($_POST['subloop_payment_intent_id'])) : '';
            $subscription_id = isset($_POST['subloop_subscription_id']) ? sanitize_text_field(wp_unslash($_POST['subloop_subscription_id'])) : '';
            $reference = WC()->session->get('subloop_checkout_reference');
            if (!$order || !$intent_id || !$subscription_id || !$reference) {
                throw new Exception(__('Payment confirmation is missing. Please try again.', 'subloop-woocommerce'));
            }
            $result = $this->api_request('POST', '/woocommerce/v1/verify-subscription', array(
                'checkout_reference' => $reference,
                'payment_intent_id' => $intent_id,
                'subscription_id' => $subscription_id,
                'amount' => $this->minor_amount($order->get_total()),
                'currency' => strtolower($order->get_currency()),
            ));
            if (is_wp_error($result) || empty($result['paid'])) {
                throw new Exception(is_wp_error($result) ? $result->get_error_message() : __('The payment was not completed.', 'subloop-woocommerce'));
            }
            $order->update_meta_data('_subloop_checkout_reference', $reference);
            $order->update_meta_data('_subloop_payment_intent', $intent_id);
            $order->update_meta_data('_subloop_subscription_id', $subscription_id);
            $order->save();
            $order->payment_complete($intent_id);
            $order->add_order_note(sprintf(__('Stripe payment schedule started (%1$s, payment %2$s).', 'subloop-woocommerce'), $subscription_id, $intent_id));
            WC()->cart->empty_cart();
            WC()->session->__unset('subloop_checkout_reference');
            WC()->session->__unset('subloop_checkout_signature');
            return array('result' => 'success', 'redirect' => $this->get_return_url($order));
        }

        public function connection_token()
        {
            return $this->connection_token;
        }
    }

    add_filter('woocommerce_payment_gateways', static function ($gateways) {
        $gateways[] = 'WC_Gateway_Subloop';
        return $gateways;
    });

    add_action('wc_ajax_subloop_prepare_payment', static function () {
        $gateways = WC()->payment_gateways()->payment_gateways();
        if (isset($gateways['subloop'])) {
            $gateways['subloop']->prepare_payment();
        }
        wp_send_json_error(array('message' => __('Payment gateway is unavailable.', 'subloop-woocommerce')), 503);
    });
    add_action('wc_ajax_nopriv_subloop_prepare_payment', static function () {
        $gateways = WC()->payment_gateways()->payment_gateways();
        if (isset($gateways['subloop'])) {
            $gateways['subloop']->prepare_payment();
        }
        wp_send_json_error(array('message' => __('Payment gateway is unavailable.', 'subloop-woocommerce')), 503);
    });
});

add_action('rest_api_init', static function () {
    register_rest_route('subloop/v1', '/webhook', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => static function (WP_REST_Request $request) {
            if (!function_exists('WC')) {
                return new WP_Error('woocommerce_unavailable', 'WooCommerce unavailable', array('status' => 503));
            }
            $gateways = WC()->payment_gateways()->payment_gateways();
            $gateway = isset($gateways['subloop']) ? $gateways['subloop'] : null;
            $token = $gateway && method_exists($gateway, 'connection_token') ? $gateway->connection_token() : '';
            $body = $request->get_body();
            $received = (string) $request->get_header('x-subloop-signature');
            $key = hash('sha256', $token);
            $expected = hash_hmac('sha256', $body, $key);
            if (!$token || !$received || !hash_equals($expected, $received)) {
                return new WP_Error('invalid_signature', 'Invalid signature', array('status' => 401));
            }
            $event = json_decode($body, true);
            $reference = isset($event['checkout_reference']) ? sanitize_text_field($event['checkout_reference']) : '';
            if (!$reference) {
                return new WP_Error('invalid_event', 'Missing checkout reference', array('status' => 400));
            }
            $orders = wc_get_orders(array('limit' => 1, 'meta_key' => '_subloop_checkout_reference', 'meta_value' => $reference));
            if (!$orders) {
                return rest_ensure_response(array('received' => true, 'order_found' => false));
            }
            $order = $orders[0];
            $intent_id = isset($event['payment_intent_id']) ? sanitize_text_field($event['payment_intent_id']) : '';
            $subscription_id = isset($event['subscription_id']) ? sanitize_text_field($event['subscription_id']) : '';
            $event_name = isset($event['event']) ? sanitize_text_field($event['event']) : '';
            if ($subscription_id) {
                $order->update_meta_data('_subloop_subscription_id', $subscription_id);
                $order->save();
            }
            if ('payment.succeeded' === ($event['event'] ?? '') && !$order->is_paid()) {
                $order->payment_complete($intent_id);
                $order->add_order_note(sprintf(__('Stripe payment confirmed by Subloop (%s).', 'subloop-woocommerce'), $intent_id));
            } elseif ('payment.failed' === ($event['event'] ?? '') && !$order->is_paid()) {
                $order->update_status('failed', __('Stripe reported that the payment failed.', 'subloop-woocommerce'));
            } elseif ('subscription.payment_succeeded' === $event_name) {
                if (!$order->is_paid()) $order->payment_complete($intent_id);
                $order->add_order_note(sprintf(__('Subloop scheduled payment succeeded (%s).', 'subloop-woocommerce'), $intent_id ?: $subscription_id));
            } elseif (in_array($event_name, array('subscription.payment_failed', 'subscription.payment_action_required'), true)) {
                $order->add_order_note(sprintf(__('Subloop scheduled payment failed (%s).', 'subloop-woocommerce'), $intent_id ?: $subscription_id));
            } elseif ('subscription.canceled' === $event_name) {
                $order->add_order_note(sprintf(__('Subloop payment schedule canceled (%s).', 'subloop-woocommerce'), $subscription_id));
            }
            if (function_exists('wcs_get_subscriptions_for_order') && 0 === strpos($event_name, 'subscription.')) {
                $local_subscriptions = wcs_get_subscriptions_for_order($order->get_id(), array('order_type' => 'any'));
                foreach ($local_subscriptions as $local_subscription) {
                    if ($subscription_id) $local_subscription->update_meta_data('_subloop_subscription_id', $subscription_id);
                    if ('subscription.payment_succeeded' === $event_name && $local_subscription->has_status(array('pending', 'on-hold'))) {
                        $local_subscription->update_status('active', __('Payment confirmed by Subloop.', 'subloop-woocommerce'));
                    } elseif (in_array($event_name, array('subscription.payment_failed', 'subscription.payment_action_required'), true) && !$local_subscription->has_status(array('cancelled', 'expired'))) {
                        $local_subscription->update_status('on-hold', __('Payment failed in Subloop.', 'subloop-woocommerce'));
                    } elseif ('subscription.canceled' === $event_name && !$local_subscription->has_status('cancelled')) {
                        $local_subscription->update_status('cancelled', __('Canceled in Subloop.', 'subloop-woocommerce'));
                    }
                    $local_subscription->save();
                }
            }
            return rest_ensure_response(array('received' => true, 'order_found' => true));
        },
    ));
});
