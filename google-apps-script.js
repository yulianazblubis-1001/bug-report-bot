/**
 * Google Apps Script for Credit Limit Top-Up Sheet
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet
 * 2. Go to Extensions → Apps Script
 * 3. Paste this entire script
 * 4. Go to Project Settings (gear icon) → Script Properties
 * 5. Add property: BOT_WEBHOOK_URL = https://your-app.replit.app/sheet-update
 * 6. Add property: WEBHOOK_SECRET = (same value as SHEET_WEBHOOK_SECRET env var in Replit)
 * 7. Go to Triggers (clock icon on left sidebar)
 * 8. Click "+ Add Trigger"
 *    - Function: onSheetEdit
 *    - Event source: From spreadsheet
 *    - Event type: On edit
 * 9. Save and authorize when prompted
 *
 * HOW IT WORKS:
 * When column Q (Status) is changed to "APPROVED" or "REJECTED",
 * this script sends a POST request to your bot's /sheet-update endpoint
 * with the row data so the bot can:
 * - Add emoji reactions on Slack (:git-approved: or :rejected:)
 * - Post thread replies on Slack
 * - Send WhatsApp notifications (for rejections)
 */

function onSheetEdit(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var range = e.range;
    
    if (sheet.getName() !== 'Sheet1') return;
    
    var col = range.getColumn();
    // Column Q = 17 (Status column)
    if (col !== 17) return;
    
    var newValue = (range.getValue() || '').toString().trim().toUpperCase();
    
    if (newValue !== 'APPROVED' && newValue !== 'REJECTED') return;
    
    var row = range.getRow();
    if (row <= 1) return; // Skip header row
    
    var rowData = sheet.getRange(row, 1, 1, 21).getValues()[0];
    
    var payload = {
      requestId: rowData[1] || '',        // Column B
      status: newValue,                     // Column Q
      reviewedBy: rowData[17] || '',       // Column R
      rejectionReason: rowData[19] || '',  // Column T
      slackTs: rowData[20] || '',          // Column U
      reporterPhone: rowData[3] || '',     // Column D
      reporterName: rowData[2] || '',      // Column C
      farmerName: rowData[5] || '',        // Column F
    };
    
    var botUrl = PropertiesService.getScriptProperties().getProperty('BOT_WEBHOOK_URL');
    if (!botUrl) {
      Logger.log('BOT_WEBHOOK_URL not set in Script Properties');
      return;
    }
    
    var webhookSecret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      headers: webhookSecret ? { 'X-Webhook-Secret': webhookSecret } : {},
    };
    
    var response = UrlFetchApp.fetch(botUrl, options);
    Logger.log('Sheet update sent: ' + response.getContentText());
    
  } catch (error) {
    Logger.log('Error in onSheetEdit: ' + error.toString());
  }
}
