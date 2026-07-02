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

  const usersSnapshot = await db.collection('users').get();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    for (const docSnap of usersSnapshot.docs) {
      const data = docSnap.data();

      if (!data.settings?.monthlyReportEmailOptIn || !data.userEmail) {
        skipped++;
        continue;
      }

      const report = generateMonthlyReportData(data.cards || [], data.transactions || [], year, month, 'all');

      try {
        const pdfBuffer = await renderReportPdf(browser, report, year, month);

        await transporter.sendMail({
          from: `"ApexWallet Tracker" <${process.env.GMAIL_USER}>`,
          to: data.userEmail,
          subject: `Your ${monthLabel} ApexWallet Report`,
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
              <p>Your ${monthLabel} spending report is attached as a PDF -- a full breakdown across all your cards, with category and card charts included.</p>
              <p style="color:#94a3b8;font-size:11px;">You're receiving this because monthly email reports are enabled in your ApexWallet Tracker profile settings. Turn it off any time from Profile &amp; Settings.</p>
            </div>
          `,
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
