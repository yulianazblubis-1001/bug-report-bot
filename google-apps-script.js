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
 * COLUMN STRUCTURE (A-X, 24 columns):
 * A: Timestamp, B: Request ID, C: Reporter Name, D: Reporter Phone,
 * E: FG, F: Farmer, G: Land Size, H: Current Limit, I: Requested Top-Up,
 * J: Credit Type, K: Reason, L: SO Number,
 * M: Farmer Income & Business, N: Jaminan Info,
 * O: Doc Signed SO/Letter, P: Doc Farmer Holding,
 * Q: Doc Land Ownership, R: Doc Jaminan,
 * S: Doc Survey Photo with TM,
 * T: Status, U: Reviewed By, V: Review Date, W: Rejection Reason, X: Slack TS
 *
 * HOW IT WORKS:
 * When column T (Status) is changed to "APPROVED" or "REJECTED",
 * this script sends a POST request to your bot's /sheet-update endpoint
 */

function onSheetEdit(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var range = e.range;
    
    if (sheet.getName() !== 'request') return;
    
    var col = range.getColumn();
    // Column T = 20 (Status column, was S = 19 before adding column S for doc)
    if (col !== 20) return;
    
    var newValue = (range.getValue() || '').toString().trim().toUpperCase();
    
    if (newValue !== 'APPROVED' && newValue !== 'REJECTED') return;
    
    var row = range.getRow();
    if (row <= 1) return; // Skip header row
    
    var rowData = sheet.getRange(row, 1, 1, 24).getValues()[0];
    var slackTsCell = sheet.getRange(row, 24).getDisplayValue(); // Column X = 24
    
    var payload = {
      requestId: (rowData[1] || '').toString(),   // Column B (index 1)
      status: newValue,                            // Column T (index 19)
      reviewedBy: (rowData[20] || '').toString(),  // Column U (index 20)
      rejectionReason: (rowData[22] || '').toString(), // Column W (index 22)
      slackTs: slackTsCell || '',                  // Column X — use getDisplayValue to preserve precision
      reporterPhone: (rowData[3] || '').toString(),    // Column D (index 3)
      reporterName: (rowData[2] || '').toString(),     // Column C (index 2)
      farmerName: (rowData[5] || '').toString(),       // Column F (index 5)
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
