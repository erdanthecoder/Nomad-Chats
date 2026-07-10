const nodemailer = require('nodemailer');

let transporter;
let triedInit = false;
const fromAddress = process.env.SMTP_FROM || 'Nomad Chats <no-reply@nomadchats.local>';

function getTransporter() {
  if (triedInit) return transporter;
  triedInit = true;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

async function sendResetCodeEmail(toEmail, code) {
  const t = getTransporter();
  const subject = 'Your Nomad Chats password reset code';
  const text = `Your password reset code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `<div style="font-family:sans-serif"><p>Your password reset code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;">${code}</p><p style="color:#667781">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p></div>`;

  if (!t) {
    console.log(`\n[DEV MODE — no SMTP configured] Password reset code for ${toEmail}: ${code}\n`);
    return { delivered: false, devMode: true };
  }

  await t.sendMail({ from: fromAddress, to: toEmail, subject, text, html });
  return { delivered: true, devMode: false };
}

module.exports = { sendResetCodeEmail };
