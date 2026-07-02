#!/usr/bin/env node
// Runs on a schedule (see .github/workflows/monthly-report-email.yml) to email
// every opted-in user a consolidated report of last month's spending across
// all their cards. Uses the Firebase Admin SDK (full read access, bypasses
// Firestore Security Rules by design) and sends mail via Gmail SMTP.
//
// Required environment variables (see repo secrets, never commit real values):
//   FIREBASE_SERVICE_ACCOUNT  - JSON string of a Firebase service account key
//   GMAIL_USER                - the sending Gmail address
//   GMAIL_APP_PASSWORD        - a Gmail App Password (not the account password)

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { generateMonthlyReportData } from '../src/reportLogic.js';
import { getCategoryLabel } from '../src/categories.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function previousMonth(referenceDate = new Date()) {
  const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Builds a plain, table-based HTML email (email clients strip most modern
// CSS, so this deliberately avoids flexbox/grid/custom properties).
export function buildReportEmailHtml(report, year, month) {
  const monthLabel = `${MONTH_NAMES[month]} ${year}`;
  const scopeLabel = { personal: 'Personal', business: 'Business', all: 'All Cards' }[report.scope] || 'All Cards';
  const totalCombined = report.totalSpent + report.totalPayments;

  const statRow = (label, value) => `
    <td style="padding:12px 16px;border:1px solid #e2e8f0;border-radius:8px;">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;">${label}</div>
      <div style="font-size:18px;font-weight:700;color:#0f172a;">${value}</div>
    </td>`;

  const cardSections = [...report.cardBreakdown];
  if (report.unlinkedTransactions.length > 0) {
    cardSections.push({
      card: { name: 'Unlinked Transactions', last4: null },
      transactions: report.unlinkedTransactions,
      subtotal: report.unlinkedTransactions.reduce((s, t) => s + t.amount, 0)
    });
  }

  const cardSectionsHtml = cardSections.length === 0
    ? `<p style="color:#64748b;font-size:14px;">No transactions logged for ${monthLabel}.</p>`
    : cardSections.map(({ card, transactions, subtotal }) => `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;font-weight:700;font-size:14px;color:#0f172a;">
              ${escapeHtml(card.name)}${card.last4 ? ` (...${escapeHtml(card.last4)})` : ''}
            </td>
            <td align="right" style="padding:8px 0;font-weight:700;font-size:14px;color:#0f172a;">$${subtotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="2">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                <tr>
                  <th align="left" style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;text-transform:uppercase;">Date</th>
                  <th align="left" style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;text-transform:uppercase;">Merchant</th>
                  <th align="left" style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;text-transform:uppercase;">Category</th>
                  <th align="right" style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;text-transform:uppercase;">Amount</th>
                </tr>
                ${transactions.map(tx => `
                  <tr>
                    <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${tx.date}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(tx.merchant)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(getCategoryLabel(tx.category))}</td>
                    <td align="right" style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">$${tx.amount.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </table>
            </td>
          </tr>
        </table>
      `).join('');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:20px;margin-bottom:4px;">${monthLabel} -- ${scopeLabel}</h1>
      <p style="color:#64748b;font-size:13px;margin-top:0;">Your ApexWallet Tracker monthly report</p>

      <table width="100%" cellpadding="0" cellspacing="8" style="margin:20px 0;">
        <tr>
          ${statRow('Total Purchases', `$${report.totalSpent.toFixed(2)}`)}
          ${statRow('Card Payments Made', `$${report.totalPayments.toFixed(2)}`)}
        </tr>
        <tr>
          ${statRow('Combined Cash Out', `$${totalCombined.toFixed(2)}`)}
          ${statRow('Cards With Activity', `${report.cardBreakdown.length}`)}
        </tr>
      </table>

      ${cardSectionsHtml}

      <p style="color:#94a3b8;font-size:11px;margin-top:32px;">
        You're receiving this because monthly email reports are enabled in your ApexWallet Tracker profile settings. Turn it off any time from Profile &amp; Settings.
      </p>
    </div>
  `;
}

async function main() {
  const { year, month } = previousMonth();
  console.log(`Generating reports for ${MONTH_NAMES[month]} ${year}...`);

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const app = initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(app);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });

  const usersSnapshot = await db.collection('users').get();
  let sent = 0;
  let skipped = 0;

  for (const docSnap of usersSnapshot.docs) {
    const data = docSnap.data();

    if (!data.settings?.monthlyReportEmailOptIn || !data.userEmail) {
      skipped++;
      continue;
    }

    const report = generateMonthlyReportData(data.cards || [], data.transactions || [], year, month, 'all');
    const html = buildReportEmailHtml(report, year, month);

    try {
      await transporter.sendMail({
        from: `"ApexWallet Tracker" <${process.env.GMAIL_USER}>`,
        to: data.userEmail,
        subject: `Your ${MONTH_NAMES[month]} ${year} ApexWallet Report`,
        html
      });
      console.log(`Sent report to ${data.userEmail}`);
      sent++;
    } catch (err) {
      console.error(`Failed to send report to ${data.userEmail}:`, err.message);
    }
  }

  console.log(`Done. Sent: ${sent}, Skipped (not opted in): ${skipped}`);
}

// Only run when executed directly (not when imported, e.g. by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Monthly report job failed:', err);
    process.exit(1);
  });
}
