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
 * COLUMN STRUCTURE (A-W, 23 columns):
 * A: Timestamp, B: Request ID, C: Reporter Name, D: Reporter Phone,
 * E: FG, F: Farmer, G: Land Size, H: Current Limit, I: Requested Top-Up,
 * J: Credit Type, K: Reason, L: SO Number,
 * M: Farmer Income & Business, N: Jaminan Info,
 * O: Doc Signed SO/Letter, P: Doc Farmer Holding,
 * Q: Doc Land Ownership, R: Doc Jaminan,
 * S: Status, T: Reviewed By, U: Review Date, V: Rejection Reason, W: Slack TS
 *
 * HOW IT WORKS:
 * When column S (Status) is changed to "APPROVED" or "REJECTED",
 * this script sends a POST request to your bot's /sheet-update endpoint
 */

function onSheetEdit(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var range = e.range;
    
    if (sheet.getName() !== 'request') return;
    
    var col = range.getColumn();
    // Column S = 19 (Status column)
    if (col !== 19) return;
    
    var newValue = (range.getValue() || '').toString().trim().toUpperCase();
    
    if (newValue !== 'APPROVED' && newValue !== 'REJECTED') return;
    
    var row = range.getRow();
    if (row <= 1) return; // Skip header row
    
    var rowData = sheet.getRange(row, 1, 1, 23).getValues()[0];
    var slackTsCell = sheet.getRange(row, 23).getDisplayValue();
    
    var payload = {
      requestId: (rowData[1] || '').toString(),  // Column B
      status: newValue,                           // Column S
      reviewedBy: (rowData[19] || '').toString(), // Column T
      rejectionReason: (rowData[21] || '').toString(), // Column V
      slackTs: slackTsCell || '',                 // Column W — use getDisplayValue to preserve precision
      reporterPhone: (rowData[3] || '').toString(),    // Column D
      reporterName: (rowData[2] || '').toString(),     // Column C
      farmerName: (rowData[5] || '').toString(),       // Column F
    };
    
    Logger.log('Payload: ' + JSON.stringify(payload));
    
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
