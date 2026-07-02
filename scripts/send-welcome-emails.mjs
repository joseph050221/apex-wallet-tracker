#!/usr/bin/env node
// Runs on a schedule (see .github/workflows/welcome-email.yml) to email
// every new user a welcome guide detailing how ApexWallet works.
//
// Required environment variables:
//   FIREBASE_SERVICE_ACCOUNT  - JSON string of a Firebase service account key
//   GMAIL_USER                - the sending Gmail address
//   GMAIL_APP_PASSWORD        - a Gmail App Password (not the account password)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

// HTML Template for the welcome email
function buildWelcomeEmailHtml(email, name) {
  const greetingName = name ? name.trim() : 'there';
  return `
    <div style="background:#f8fafc;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.6;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.03);border:1px solid #e2e8f0;">
        <!-- Header -->
        <tr>
          <td style="padding:32px;background:#0f172a;color:#ffffff;border-bottom:1px solid #1e293b;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:42px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="40" height="40" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa);border-radius:10px;">
                    <tr><td align="center" valign="middle" style="color:#ffffff;font-size:20px;font-weight:800;">A</td></tr>
                  </table>
                </td>
                <td style="padding-left:14px;font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">
                  Apex<span style="font-weight:500;color:#a78bfa;">Wallet</span>
                </td>
              </tr>
            </table>
            <h1 style="font-size:20px;margin:24px 0 0;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">Welcome to ApexWallet Tracker!</h1>
            <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">We're thrilled to help you take control of your expenses.</p>
          </td>
        </tr>

        <!-- Main Body -->
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0 0 20px;font-size:15px;color:#334155;font-weight:600;">
              Hi ${greetingName},
            </p>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;">
              Thank you for signing up for <strong>ApexWallet Tracker</strong>! We've designed this app to be a fully client-private, modern personal & business expense hub. 
            </p>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;">
              Here is a quick guide on how everything works:
            </p>

            <!-- Guide sections -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;">
              <!-- Cards -->
              <tr>
                <td valign="top" style="padding-bottom:20px;">
                  <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">💳 1. Add Credit & Debit Cards</div>
                  <div style="font-size:14px;color:#475569;margin-left:4px;">
                    Navigate to <strong>My Cards</strong> and add your payment methods. Customize them with premium card skins (deep blue, gold, dark, purple) and assign them a <strong>Personal</strong> or <strong>Business</strong> scope. You can also specify credit limits to monitor utilization thresholds.
                  </div>
                </td>
              </tr>
              <!-- Manual inputs -->
              <tr>
                <td valign="top" style="padding-bottom:20px;">
                  <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">✍️ 2. Log Expenses & Payments</div>
                  <div style="font-size:14px;color:#475569;margin-left:4px;">
                    Click <strong>Add Expense</strong> to manual-input purchases. The system auto-assigns merchant category icons and runs duplicate detection checks (flags transactions matching amount and merchant name logged within 10 minutes). Log credit card bill payments separately to verify your net monthly cash outflow.
                  </div>
                </td>
              </tr>
              <!-- CSV/PDF imports -->
              <tr>
                <td valign="top" style="padding-bottom:20px;">
                  <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">📁 3. Import Bank Statements</div>
                  <div style="font-size:14px;color:#475569;margin-left:4px;">
                    Instead of manual input, click <strong>Import</strong> in the header and upload CSV or PDF statements. All parsing happens entirely in your local browser sandbox to keep data 100% private.
                  </div>
                </td>
              </tr>
              <!-- AI Statement parsing -->
              <tr>
                <td valign="top" style="padding-bottom:20px;">
                  <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">🤖 4. AI-Powered Fallback Parsing</div>
                  <div style="font-size:14px;color:#475569;margin-left:4px;">
                    For PDF statement layouts that standard parsers can't read, save your own Anthropic API key in Settings. The browser will call Claude directly to securely extract transactions. Sensitve card numbers are automatically redacted before sending.
                  </div>
                </td>
              </tr>
              <!-- Budgets & Alerts -->
              <tr>
                <td valign="top" style="padding-bottom:20px;">
                  <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">📈 5. Category Budgets & Warnings</div>
                  <div style="font-size:14px;color:#475569;margin-left:4px;">
                    Open <strong>Profile & Settings</strong> to customize monthly budgets per category (Dining, Bills, Travel, etc.). Real-time visual toasts, warning tones, and browser desktop notifications will fire if you approach or exceed 80% and 100% of your category allowance.
                  </div>
                </td>
              </tr>
              <!-- Reports -->
              <tr>
                <td valign="top" style="padding-bottom:20px;">
                  <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">📄 6. Monthly Reports & Emails</div>
                  <div style="font-size:14px;color:#475569;margin-left:4px;">
                    Check <strong>Analytics</strong> to generate printable monthly reports, and opt into automatic monthly PDF reports sent straight to your email.
                  </div>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 20px;font-size:15px;color:#334155;text-align:center;padding:15px;background:#f8fafc;border-radius:10px;font-weight:600;border:1px dashed #cbd5e1;">
              💡 Need help? Click the "Help" link in the sidebar or ask our new AI Financial Assistant directly in the "Q&A" tab!
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:28px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#64748b;line-height:1.5;">
            Sent by ApexWallet Tracker. You can manage your preferences inside your dashboard Profile & Settings panel.
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function main() {
  console.log('Checking for new users to send welcome emails...');

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable.');
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  
  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  const db = getFirestore();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  // Query users where welcomeEmailSent is false (or not set)
  const usersSnap = await db.collection('users')
    .where('settings.welcomeEmailSent', '==', false)
    .get();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data();
    const email = data.userEmail;
    const settings = data.settings || {};
    const name = settings.fullName || '';

    if (!email) {
      // Mark it sent anyway so we do not loop on it
      await docSnap.ref.update({ 'settings.welcomeEmailSent': true });
      skipped++;
      continue;
    }

    try {
      await transporter.sendMail({
        from: `"ApexWallet Tracker" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Welcome to ApexWallet Tracker - Get Started!',
        html: buildWelcomeEmailHtml(email, name)
      });

      // Mark as sent
      await docSnap.ref.update({ 'settings.welcomeEmailSent': true });
      console.log(`Welcome email successfully sent to ${email}`);
      sent++;
    } catch (err) {
      console.error(`Failed to send welcome email to ${email}:`, err.message);
      failed++;
    }
  }

  console.log(`Summary: Sent welcome emails: ${sent}, Skipped: ${skipped}, Failed: ${failed}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error('Welcome email scheduler job failed:', err);
    process.exit(1);
  });
}
