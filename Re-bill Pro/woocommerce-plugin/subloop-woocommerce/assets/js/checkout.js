(function ($) {
  'use strict';

  if (!window.SubloopWC || !window.Stripe) return;

  var stripe = Stripe(SubloopWC.publishableKey);
  var elements = null;
  var paymentElement = null;
  var expressElement = null;
  var clientSecret = '';
  var preparing = false;
  var bypassSubmit = false;
  var prepareTimer = null;

  var appearance = {
    theme: 'night',
    variables: {
      colorPrimary: '#6c5cff',
      colorBackground: '#17171f',
      colorText: '#f4f2ff',
      colorTextSecondary: '#a19eae',
      colorDanger: '#f87171',
      borderRadius: '9px',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      spacingUnit: '4px'
    },
    rules: {
      '.Input': { border: '1px solid #343440', boxShadow: 'none' },
      '.Input:focus': { border: '1px solid #6c5cff', boxShadow: '0 0 0 3px rgba(108,92,255,.18)' },
      '.Tab': { border: '1px solid #343440' },
      '.Tab--selected': { border: '1px solid #6c5cff', color: '#8b7fff' }
    }
  };

  function selected() {
    return $('input[name="payment_method"]:checked').val() === SubloopWC.gatewayId;
  }

  function error(message) {
    $('#subloop-payment-error').text(message || SubloopWC.errorMessage).show();
  }

  function clearError() {
    $('#subloop-payment-error').empty().hide();
  }

  function billingDetails() {
    var first = $('#billing_first_name').val() || '';
    var last = $('#billing_last_name').val() || '';
    return {
      name: $.trim(first + ' ' + last),
      email: $('#billing_email').val() || undefined,
      phone: $('#billing_phone').val() || undefined,
      address: {
        line1: $('#billing_address_1').val() || undefined,
        line2: $('#billing_address_2').val() || undefined,
        city: $('#billing_city').val() || undefined,
        state: $('#billing_state').val() || undefined,
        postal_code: $('#billing_postcode').val() || undefined,
        country: $('#billing_country').val() || undefined
      }
    };
  }

  function resetMountedElements() {
    try { if (paymentElement) paymentElement.unmount(); } catch (_e) {}
    try { if (expressElement) expressElement.unmount(); } catch (_e) {}
    paymentElement = null;
    expressElement = null;
    elements = null;
    clientSecret = '';
    $('#subloop-payment-intent-id').val('');
  }

  function mountElements(data) {
    resetMountedElements();
    clientSecret = data.client_secret;
    elements = stripe.elements({ clientSecret: clientSecret, appearance: appearance });
    paymentElement = elements.create('payment', {
      layout: { type: 'accordion', defaultCollapsed: false, radios: false, spacedAccordionItems: false },
      fields: { billingDetails: { name: 'never', email: 'never', phone: 'never', address: 'never' } }
    });
    paymentElement.mount('#subloop-payment-element');
    paymentElement.on('change', function (event) { if (event.error) error(event.error.message); else clearError(); });

    expressElement = elements.create('expressCheckout', {
      buttonType: { applePay: 'plain', googlePay: 'plain', amazonPay: 'pay' },
      buttonTheme: { applePay: 'white-outline', googlePay: 'black', amazonPay: 'gold' },
      buttonHeight: 48,
      layout: { maxColumns: 2, maxRows: 2, overflow: 'auto' }
    });
    expressElement.mount('#subloop-express-element');
    expressElement.on('ready', function (event) {
      $('#subloop-express-element').toggle(!!(event && event.availablePaymentMethods));
      $('#subloop-payment-divider').toggle(!!(event && event.availablePaymentMethods));
    });
    expressElement.on('confirm', function (event) {
      confirmPayment(event);
    });
  }

  function preparePayment(continueAfter) {
    if (!selected() || preparing || !$('#subloop-payment-ui').length) return;
    preparing = true;
    clearError();
    $.ajax({
      url: SubloopWC.ajaxUrl,
      method: 'POST',
      dataType: 'json',
      data: {
        nonce: SubloopWC.nonce,
        billing_email: $('#billing_email').val() || ''
      }
    }).done(function (response) {
      if (!response || !response.success || !response.data || !response.data.client_secret) {
        error(response && response.data && response.data.message);
        return;
      }
      mountElements(response.data);
      if (continueAfter) confirmPayment();
    }).fail(function (xhr) {
      var json = xhr.responseJSON || {};
      error(json.data && json.data.message ? json.data.message : SubloopWC.errorMessage);
    }).always(function () {
      preparing = false;
    });
  }

  function confirmPayment(expressEvent) {
    if (!elements || !clientSecret) {
      preparePayment(true);
      return;
    }
    clearError();
    elements.submit().then(function (submission) {
      if (submission.error) throw submission.error;
      return stripe.confirmPayment({
        elements: elements,
        clientSecret: clientSecret,
        confirmParams: { payment_method_data: { billing_details: billingDetails() } },
        redirect: 'if_required'
      });
    }).then(function (result) {
      if (!result) return;
      if (result.error) throw result.error;
      if (!result.paymentIntent || result.paymentIntent.status !== 'succeeded') {
        throw new Error(SubloopWC.errorMessage);
      }
      $('#subloop-payment-intent-id').val(result.paymentIntent.id);
      bypassSubmit = true;
      $('#place_order').trigger('click');
    }).catch(function (err) {
      if (expressEvent && typeof expressEvent.paymentFailed === 'function') expressEvent.paymentFailed({ reason: 'fail' });
      error(err && err.message ? err.message : SubloopWC.errorMessage);
      $('form.checkout').removeClass('processing').unblock();
    });
  }

  $('form.checkout').on('checkout_place_order_subloop', function () {
    if (bypassSubmit) {
      bypassSubmit = false;
      return true;
    }
    confirmPayment();
    return false;
  });

  $(document.body).on('updated_checkout payment_method_selected', function () {
    if (!selected()) return;
    window.clearTimeout(prepareTimer);
    prepareTimer = window.setTimeout(function () { preparePayment(false); }, 180);
  });

  $(function () {
    if (selected()) preparePayment(false);
  });
})(jQuery);
