/**
 * Whitelist configuration
 * 
 * Add your agronomist phone numbers here.
 * Format: country code + number, no + or spaces
 * Example: "628123456789" for Indonesian number +62-812-345-6789
 * 
 * HOW TO ADD IN REPLIT:
 * Option 1: Edit this file directly
 * Option 2: Use the WHITELISTED_NUMBERS env variable (comma-separated)
 *           e.g. WHITELISTED_NUMBERS=628123456789,628198765432,84912345678
 */

// Hardcoded whitelist — add your agronomist numbers here
const HARDCODED_NUMBERS = [
    // === Indonesia (ID) ===
    // '628123456789',  // Budi - Sales AG - East Java
    // '628198765432',  // Sari - Carbon AG - Central Java

    // === Vietnam (VN) ===
    // '84912345678',   // Linh - Sales AG - Mekong Delta
];

/**
 * Get the full whitelist (hardcoded + env variable)
 */
function getWhitelist() {
    const envNumbers = process.env.WHITELISTED_NUMBERS
        ? process.env.WHITELISTED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
        : [];

    return new Set([...HARDCODED_NUMBERS, ...envNumbers]);
}

/**
 * Check if a phone number is whitelisted
 * Returns true if whitelist is empty (no restriction) or number is in list
 */
function isWhitelisted(phoneNumber) {
    const whitelist = getWhitelist();

    // If no numbers are configured, allow everyone (open mode)
    if (whitelist.size === 0) {
        return true;
    }

    // Clean the phone number — remove +, spaces, dashes
    const cleaned = phoneNumber.replace(/[\+\s\-]/g, '');

    return whitelist.has(cleaned);
}

/**
 * The message sent to non-whitelisted numbers
 */
const REJECTED_MSG = `⚠️ Maaf, nomor kamu belum terdaftar di sistem Rize Report Bot.

Hubungi Territory Manager kamu untuk mendaftarkan nomor WhatsApp kamu.

_(Sorry, your number is not registered. Contact your Territory Manager to register.)_`;

module.exports = { isWhitelisted, getWhitelist, REJECTED_MSG };
