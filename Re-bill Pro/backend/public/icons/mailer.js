// mailer.js — email notifications for failed payments
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send failed payment alert with card update link
async function sendFailedPaymentEmail({ email, name, amount, currency, updateUrl }) {
  if (!process.env.SMTP_USER) {
    console.log(`[mailer] SMTP not configured — would email ${email} about failed $${(amount / 100).toFixed(2)} payment`);
    return;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency.toUpperCase()
  }).format(amount / 100);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'Rebill <noreply@rebill.app>',
    to: email,
    subject: `Action required: Your ${formatted} payment failed`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">Payment failed</h2>
        <p style="color: #555; line-height: 1.6;">Hi ${name || 'there'},</p>
        <p style="color: #555; line-height: 1.6;">
          We couldn't process your payment of <strong>${formatted}</strong>. 
          This could be due to an expired card, insufficient funds, or your bank declining the transaction.
        </p>
        <a href="${updateUrl}" style="
          display: inline-block; margin: 24px 0;
          background: #0f172a; color: #fff; text-decoration: none;
          padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 500;
        ">Update payment method</a>
        <p style="color: #999; font-size: 13px;">
          If you think this is an error, please reply to this email and we'll sort it out.
        </p>
      </div>
    `,
  });

  console.log(`[mailer] Failed payment email sent to ${email}`);
}

// Send payment receipt
async function sendReceiptEmail({ email, name, amount, currency, paymentIntentId }) {
  if (!process.env.SMTP_USER) {
    console.log(`[mailer] SMTP not configured — would send receipt to ${email}`);
    return;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency.toUpperCase()
  }).format(amount / 100);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'Rebill <noreply@rebill.app>',
    to: email,
    subject: `Payment receipt — ${formatted}`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 8px;">Payment confirmed ✓</h2>
        <p style="color: #555; line-height: 1.6;">Hi ${name || 'there'},</p>
        <p style="color: #555; line-height: 1.6;">
          Your payment of <strong>${formatted}</strong> was successfully processed.
        </p>
        <p style="color: #999; font-size: 13px;">Reference: ${paymentIntentId}</p>
      </div>
    `,
  });
}

module.exports = { sendFailedPaymentEmail, sendReceiptEmail };
