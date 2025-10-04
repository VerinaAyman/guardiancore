// GuardianCore Crypto Utilities - PBKDF2 PIN Hashing & Recovery Codes
// Week 4: Hardened PIN storage with no plaintext

/**
 * Generate a random salt (16 bytes)
 */
export async function generateSalt() {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return arrayBufferToBase64(buffer);
}

/**
 * Derive key from PIN using PBKDF2-HMAC-SHA-256
 * @param {string} pin - User's PIN
 * @param {string} saltBase64 - Base64-encoded salt
 * @param {number} iterations - PBKDF2 iterations (default: 310000)
 * @returns {Promise<string>} Base64-encoded hash
 */
export async function hashPin(pin, saltBase64, iterations = 310000) {
  const enc = new TextEncoder();
  const pinBuffer = enc.encode(pin);
  const saltBuffer = base64ToArrayBuffer(saltBase64);
  
  // Import PIN as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    pinBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  
  // Derive bits using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    256 // 32 bytes
  );
  
  return arrayBufferToBase64(new Uint8Array(derivedBits));
}

/**
 * Verify PIN against stored hash
 * @param {string} inputPin - User's input PIN
 * @param {object} stored - Stored PIN data { salt, hash, iter }
 * @returns {Promise<boolean>} True if PIN matches
 */
export async function verifyPin(inputPin, stored) {
  const derivedHash = await hashPin(inputPin, stored.salt, stored.iter);
  return constantTimeCompare(derivedHash, stored.hash);
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generate recovery codes (10 codes, 12 chars each)
 * Format: XXXX-XXXX-XXXX
 * Alphabet: ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no look-alikes)
 */
export async function generateRecoveryCodes(count = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes = [];
  const seen = new Set();
  
  while (codes.length < count) {
    let code = "";
    const buffer = new Uint8Array(12);
    crypto.getRandomValues(buffer);
    
    for (let i = 0; i < 12; i++) {
      code += alphabet[buffer[i] % alphabet.length];
    }
    
    // Format as XXXX-XXXX-XXXX
    const formatted = code.match(/.{1,4}/g).join("-");
    
    // Ensure uniqueness
    if (!seen.has(formatted)) {
      codes.push(formatted);
      seen.add(formatted);
    }
  }
  
  return codes;
}

/**
 * Hash a recovery code for storage
 */
export async function hashRecoveryCode(code, saltBase64, iterations = 310000) {
  // Remove dashes and hash
  const cleanCode = code.replace(/-/g, "");
  return await hashPin(cleanCode, saltBase64, iterations);
}

/**
 * Generate UUID v4
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Array buffer to Base64
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 to Array buffer
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Store hashed PIN
 */
export async function storePin(pin) {
  const salt = await generateSalt();
  const hash = await hashPin(pin, salt);
  
  const pinData = {
    algo: "PBKDF2-SHA256",
    iter: 310000,
    salt: salt,
    hash: hash,
    created_at: new Date().toISOString()
  };
  
  await chrome.storage.local.set({ pin: pinData });
  return pinData;
}

/**
 * Create recovery codes batch
 */
export async function createRecoveryBatch() {
  const codes = await generateRecoveryCodes(10);
  const batchId = generateUUID();
  
  // Hash each code with unique salt
  const hashedCodes = [];
  for (const code of codes) {
    const salt = await generateSalt();
    const hash = await hashRecoveryCode(code, salt);
    
    hashedCodes.push({
      id: generateUUID(),
      salt: salt,
      iter: 310000,
      hash: hash,
      used: false,
      used_at: null
    });
  }
  
  const batch = {
    version: 1,
    batch_id: batchId,
    codes: hashedCodes,
    created_at: new Date().toISOString(),
    active: true
  };
  
  // Mark all previous batches as inactive
  const { recovery_batches = [] } = await chrome.storage.local.get("recovery_batches");
  for (const oldBatch of recovery_batches) {
    oldBatch.active = false;
  }
  recovery_batches.push(batch);
  
  await chrome.storage.local.set({ recovery_batches });
  
  // Return plaintext codes (only time they're visible)
  return { batch_id: batchId, codes: codes };
}

/**
 * Verify recovery code
 */
export async function verifyRecoveryCode(inputCode) {
  const { recovery_batches = [] } = await chrome.storage.local.get("recovery_batches");
  
  for (const batch of recovery_batches) {
    if (!batch.active) continue;
    
    for (let i = 0; i < batch.codes.length; i++) {
      const codeData = batch.codes[i];
      if (codeData.used) continue;
      
      const derivedHash = await hashRecoveryCode(inputCode, codeData.salt, codeData.iter);
      if (constantTimeCompare(derivedHash, codeData.hash)) {
        // Mark as used
        codeData.used = true;
        codeData.used_at = new Date().toISOString();
        await chrome.storage.local.set({ recovery_batches });
        
        return { valid: true, code_id: codeData.id, batch_id: batch.batch_id };
      }
    }
  }
  
  return { valid: false };
}

/**
 * Get active recovery batch status
 */
export async function getRecoveryStatus() {
  const { recovery_batches = [] } = await chrome.storage.local.get("recovery_batches");
  const activeBatch = recovery_batches.find(b => b.active);
  
  if (!activeBatch) {
    return { has_codes: false };
  }
  
  const unusedCount = activeBatch.codes.filter(c => !c.used).length;
  
  return {
    has_codes: true,
    batch_id: activeBatch.batch_id,
    created_at: activeBatch.created_at,
    total_codes: activeBatch.codes.length,
    unused_codes: unusedCount,
    used_codes: activeBatch.codes.length - unusedCount
  };
}
