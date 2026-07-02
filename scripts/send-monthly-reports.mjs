#!/usr/bin/env node
// Runs on a schedule (see .github/workflows/monthly-report-email.yml) to email
// every opted-in user a consolidated PDF report of last month's spending
// across all their cards. Uses the Firebase Admin SDK (full read access,
// bypasses Firestore Security Rules by design), renders the exact same
// report template the in-app "Print / Save as PDF" button uses (see
// src/reportHtml.js) through headless Chromium to produce a real PDF, and
// sends it via Gmail SMTP as an attachment.
//
// Required environment variables (see repo secrets, never commit real values):
//   FIREBASE_SERVICE_ACCOUNT  - JSON string of a Firebase service account key
//   GMAIL_USER                - the sending Gmail address
//   GMAIL_APP_PASSWORD        - a Gmail App Password (not the account password)

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import puppeteer from 'puppeteer';
import { generateMonthlyReportData } from '../src/reportLogic.js';
import { buildReportHtmlDocument } from '../src/reportHtml.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function previousMonth(referenceDate = new Date()) {
  const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// Renders the shared report template through headless Chromium and returns
// a PDF Buffer -- the same document a user would get from the in-app
// "Print / Save as PDF" button.
async function renderReportPdf(browser, report, year, month) {
  const html = buildReportHtmlDocument(report, year, month);
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__chartsReady === true', { timeout: 10000 });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px' } });
  } finally {
    await page.close();
  }
}

// Builds the email body HTML. Uses a table-based layout with inline styles
// only (no flexbox/grid, no remote images) since email clients -- Outlook
// in particular -- render HTML far less predictably than browsers and often
// block remote images by default. The logo is a small CSS-styled letter
// mark rather than an embedded SVG/image for the same reason.
function buildReportEmailHtml(monthLabel) {
  return `
    <div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:28px 32px;border-bottom:1px solid #f1f5f9;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:40px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="38" height="38" style="background-color:#8b5cf6;background:linear-gradient(135deg,#8b5cf6,#a78bfa);border-radius:10px;">
                    <tr><td align="center" valign="middle" style="width:38px;height:38px;color:#ffffff;font-size:18px;font-weight:800;font-family:Arial,Helvetica,sans-serif;">A</td></tr>
                  </table>
                </td>
                <td style="padding-left:12px;font-size:21px;font-weight:800;letter-spacing:-0.3px;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
                  Apex<span style="font-weight:500;color:#8b5cf6;">Wallet</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#0f172a;font-size:14px;line-height:1.6;">
            <p style="margin:0 0 16px;font-size:16px;font-weight:600;">Your ${monthLabel} report is ready</p>
            <p style="margin:0 0 16px;color:#334155;">
              Attached is a PDF with your full ${monthLabel} spending breakdown across all cards, including category and card charts plus a complete transaction log.
            </p>
            <p style="margin:0 0 24px;color:#334155;">
              Thanks for using ApexWallet Tracker to stay on top of your spending.
            </p>
            <p style="margin:0;color:#0f172a;">
              Best,<br>
              <span style="font-weight:700;">The ApexWallet Team</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:11px;line-height:1.6;">
            You're receiving this because monthly email reports are enabled in your ApexWallet Tracker profile settings. Turn it off any time from Profile &amp; Settings.
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function main() {
  const { year, month } = previousMonth();
  const monthLabel = `${MONTH_NAMES[month]} ${year}`;
  console.log(`Generating reports for ${monthLabel}...`);

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const app = initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(app);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });

  const usersSnapshot = await db.collection('users')
    .where('settings.monthlyReportEmailOptIn', '==', true)
    .get();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    for (const docSnap of usersSnapshot.docs) {
      const data = docSnap.data();

      if (!data.userEmail) {
        skipped++;
        continue;
      }

      const cardsSnapshot = await docSnap.ref.collection('cards').get();
      const cards = cardsSnapshot.docs.map(d => d.data());

      const transactionsSnapshot = await docSnap.ref.collection('transactions').get();
      const transactions = transactionsSnapshot.docs.map(d => d.data());

      const report = generateMonthlyReportData(cards, transactions, year, month, 'all');

      try {
        const pdfBuffer = await renderReportPdf(browser, report, year, month);

        await transporter.sendMail({
          from: `"ApexWallet Tracker" <${process.env.GMAIL_USER}>`,
          to: data.userEmail,
          subject: `Your ${monthLabel} ApexWallet Report`,
          html: buildReportEmailHtml(monthLabel),
          attachments: [{
            filename: `ApexWallet-Report-${monthLabel.replace(' ', '-')}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }]
        });

        console.log(`Sent report to ${data.userEmail}`);
        sent++;
      } catch (err) {
        console.error(`Failed to send report to ${data.userEmail}:`, err.message);
        failed++;
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`Done. Sent: ${sent}, Skipped (not opted in): ${skipped}, Failed: ${failed}`);
}

// Only run when executed directly (not when imported, e.g. by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Monthly report job failed:', err);
    process.exit(1);
  });
}
